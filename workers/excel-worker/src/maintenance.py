"""M4 精确缓存与本地数据清理。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from database import connect_database
from settings import TASK_RETENTION_DAYS

ALLOWED_SCOPES = {
    "expired_tasks",
    "selected_tasks",
    "expired_cache",
    "selected_cache",
    "all_cache",
}
TERMINAL_TASK_STATUSES = {"completed", "cancelled"}


@dataclass
class MaintenanceError(Exception):
    code: str
    message: str


def _now_datetime() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _require_string_list(value: Any, message: str) -> list[str]:
    if value is None:
        return []
    if (
        not isinstance(value, list)
        or any(not isinstance(item, str) or not item.strip() for item in value)
        or len(value) > 5000
    ):
        raise MaintenanceError("INVALID_MESSAGE", message)
    return list(dict.fromkeys(item.strip() for item in value))


def _normalize_request(payload: dict[str, Any]) -> dict[str, Any]:
    scopes = _require_string_list(payload.get("scopes"), "清理范围无效")
    if not scopes or any(scope not in ALLOWED_SCOPES for scope in scopes):
        raise MaintenanceError("INVALID_MESSAGE", "清理范围无效")
    if "all_cache" in scopes:
        scopes = [
            scope
            for scope in scopes
            if scope not in {"expired_cache", "selected_cache"}
        ]
        scopes.append("all_cache")
    return {
        "scopes": sorted(set(scopes)),
        "taskIds": _require_string_list(
            payload.get("taskIds"),
            "待删除任务无效",
        ),
        "cacheKeys": _require_string_list(
            payload.get("cacheKeys"),
            "待删除缓存无效",
        ),
    }


def _select_ids(
    connection: sqlite3.Connection,
    request: dict[str, Any],
) -> tuple[list[str], list[str]]:
    task_ids: set[str] = set()
    cache_keys: set[str] = set()
    scopes = set(request["scopes"])
    now = _now_datetime()

    if "expired_tasks" in scopes:
        cutoff = (now - timedelta(days=TASK_RETENTION_DAYS)).isoformat()
        rows = connection.execute(
            """
            SELECT id FROM tasks
            WHERE status IN ('completed', 'cancelled')
                AND updated_at < ?
            """,
            (cutoff,),
        ).fetchall()
        task_ids.update(str(row["id"]) for row in rows)

    if "selected_tasks" in scopes:
        requested = request["taskIds"]
        if not requested:
            raise MaintenanceError("INVALID_MESSAGE", "请选择待删除任务")
        placeholders = ",".join("?" for _item in requested)
        rows = connection.execute(
            f"""
            SELECT id, status FROM tasks
            WHERE id IN ({placeholders})
            """,
            requested,
        ).fetchall()
        if len(rows) != len(requested):
            raise MaintenanceError(
                "HISTORY_TASK_NOT_FOUND",
                "部分历史任务不存在",
            )
        if any(row["status"] not in TERMINAL_TASK_STATUSES for row in rows):
            raise MaintenanceError(
                "TASK_STATE_INVALID",
                "未完成任务不能直接删除",
            )
        task_ids.update(str(row["id"]) for row in rows)

    if "all_cache" in scopes:
        rows = connection.execute(
            "SELECT cache_key FROM translation_cache"
        ).fetchall()
        cache_keys.update(str(row["cache_key"]) for row in rows)
    elif "expired_cache" in scopes:
        rows = connection.execute(
            """
            SELECT cache_key FROM translation_cache
            WHERE expires_at <= ?
            """,
            (now.isoformat(),),
        ).fetchall()
        cache_keys.update(str(row["cache_key"]) for row in rows)

    if "selected_cache" in scopes:
        requested_keys = request["cacheKeys"]
        if not requested_keys:
            raise MaintenanceError("INVALID_MESSAGE", "请选择待删除缓存")
        placeholders = ",".join("?" for _item in requested_keys)
        rows = connection.execute(
            f"""
            SELECT cache_key FROM translation_cache
            WHERE cache_key IN ({placeholders})
            """,
            requested_keys,
        ).fetchall()
        cache_keys.update(str(row["cache_key"]) for row in rows)

    return sorted(task_ids), sorted(cache_keys)


def _build_plan(
    connection: sqlite3.Connection,
    request: dict[str, Any],
) -> dict[str, Any]:
    task_ids, cache_keys = _select_ids(connection, request)
    task_row_count = 0
    export_count = 0
    if task_ids:
        placeholders = ",".join("?" for _item in task_ids)
        task_row_count = int(
            connection.execute(
                f"""
                SELECT COUNT(*) AS count FROM task_rows
                WHERE task_id IN ({placeholders})
                """,
                task_ids,
            ).fetchone()["count"]
        )
        export_count = int(
            connection.execute(
                f"""
                SELECT COUNT(*) AS count FROM task_exports
                WHERE task_id IN ({placeholders})
                """,
                task_ids,
            ).fetchone()["count"]
        )
    plan_source = {
        "scopes": request["scopes"],
        "taskIds": task_ids,
        "cacheKeys": cache_keys,
    }
    task_revisions: list[tuple[str, str]] = []
    export_revisions: list[tuple[str, str, str | None]] = []
    cache_revisions: list[tuple[str, str, str]] = []
    if task_ids:
        placeholders = ",".join("?" for _item in task_ids)
        task_revisions = [
            (str(row["id"]), str(row["updated_at"]))
            for row in connection.execute(
                f"""
                SELECT id, updated_at FROM tasks
                WHERE id IN ({placeholders})
                ORDER BY id
                """,
                task_ids,
            ).fetchall()
        ]
        export_revisions = [
            (
                str(row["id"]),
                str(row["status"]),
                row["completed_at"],
            )
            for row in connection.execute(
                f"""
                SELECT id, status, completed_at FROM task_exports
                WHERE task_id IN ({placeholders})
                ORDER BY id
                """,
                task_ids,
            ).fetchall()
        ]
    if cache_keys:
        placeholders = ",".join("?" for _item in cache_keys)
        cache_revisions = [
            (
                str(row["cache_key"]),
                str(row["last_used_at"]),
                str(row["expires_at"]),
            )
            for row in connection.execute(
                f"""
                SELECT cache_key, last_used_at, expires_at
                FROM translation_cache
                WHERE cache_key IN ({placeholders})
                ORDER BY cache_key
                """,
                cache_keys,
            ).fetchall()
        ]
    revision_source = {
        **plan_source,
        "taskRevisions": task_revisions,
        "exportRevisions": export_revisions,
        "cacheRevisions": cache_revisions,
    }
    plan_hash = hashlib.sha256(
        json.dumps(
            revision_source,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        **plan_source,
        "planHash": plan_hash,
        "taskCount": len(task_ids),
        "taskRowCount": task_row_count,
        "exportCount": export_count,
        "cacheCount": len(cache_keys),
    }


def list_translation_cache(payload: dict[str, Any]) -> dict[str, Any]:
    page = payload.get("page", 1)
    page_size = payload.get("pageSize", 20)
    search = payload.get("search", "")
    if (
        not isinstance(page, int)
        or isinstance(page, bool)
        or page < 1
        or not isinstance(page_size, int)
        or isinstance(page_size, bool)
        or page_size < 1
        or page_size > 50
        or not isinstance(search, str)
        or len(search) > 100
    ):
        raise MaintenanceError("INVALID_MESSAGE", "缓存查询参数无效")

    parameters: list[Any] = []
    where_clause = ""
    if search.strip():
        escaped = (
            search.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        where_clause = (
            "WHERE source_text LIKE ? ESCAPE '\\' "
            "OR translation LIKE ? ESCAPE '\\'"
        )
        parameters.extend([f"%{escaped}%", f"%{escaped}%"])
    with connect_database() as connection:
        total = int(
            connection.execute(
                f"""
                SELECT COUNT(*) AS count
                FROM translation_cache
                {where_clause}
                """,
                parameters,
            ).fetchone()["count"]
        )
        rows = connection.execute(
            f"""
            SELECT * FROM translation_cache
            {where_clause}
            ORDER BY last_used_at DESC, cache_key
            LIMIT ? OFFSET ?
            """,
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()
    now = _now_datetime().isoformat()
    return {
        "items": [
            {
                "cacheKey": row["cache_key"],
                "sourceText": row["source_text"],
                "translation": row["translation"],
                "translatorId": row["translator_id"],
                "glossaryVersion": int(row["glossary_version"]),
                "confirmedAt": row["confirmed_at"],
                "lastUsedAt": row["last_used_at"],
                "expiresAt": row["expires_at"],
                "expired": row["expires_at"] <= now,
            }
            for row in rows
        ],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": max(1, (total + page_size - 1) // page_size),
    }


def preview_data_cleanup(payload: dict[str, Any]) -> dict[str, Any]:
    request = _normalize_request(payload)
    with connect_database() as connection:
        return _build_plan(connection, request)


def run_data_cleanup(payload: dict[str, Any]) -> dict[str, Any]:
    request = _normalize_request(payload)
    plan_hash = payload.get("planHash")
    if not isinstance(plan_hash, str) or not plan_hash:
        raise MaintenanceError(
            "CLEANUP_PLAN_CHANGED",
            "清理计划缺失，请重新预览",
        )
    with connect_database() as connection:
        plan = _build_plan(connection, request)
        if plan["planHash"] != plan_hash:
            raise MaintenanceError(
                "CLEANUP_PLAN_CHANGED",
                "数据已变化，请重新预览清理范围",
            )
        if plan["taskIds"]:
            placeholders = ",".join("?" for _item in plan["taskIds"])
            connection.execute(
                f"DELETE FROM tasks WHERE id IN ({placeholders})",
                plan["taskIds"],
            )
        if plan["cacheKeys"]:
            placeholders = ",".join("?" for _item in plan["cacheKeys"])
            connection.execute(
                f"""
                DELETE FROM translation_cache
                WHERE cache_key IN ({placeholders})
                """,
                plan["cacheKeys"],
            )
        return {
            "taskCount": plan["taskCount"],
            "taskRowCount": plan["taskRowCount"],
            "exportCount": plan["exportCount"],
            "cacheCount": plan["cacheCount"],
            "completedAt": _now_datetime().isoformat(),
        }


def run_scheduled_cleanup(_payload: dict[str, Any]) -> dict[str, Any]:
    now = _now_datetime()
    with connect_database() as connection:
        meta = connection.execute(
            "SELECT value FROM app_meta WHERE key = 'last_cleanup_at'"
        ).fetchone()
        if meta and meta["value"]:
            last_cleanup = datetime.fromisoformat(meta["value"])
            if now - last_cleanup < timedelta(hours=24):
                return {
                    "skipped": True,
                    "lastCleanupAt": meta["value"],
                }

        request = {
            "scopes": ["expired_cache", "expired_tasks"],
            "taskIds": [],
            "cacheKeys": [],
        }
        plan = _build_plan(connection, request)
        if plan["taskIds"]:
            placeholders = ",".join("?" for _item in plan["taskIds"])
            connection.execute(
                f"DELETE FROM tasks WHERE id IN ({placeholders})",
                plan["taskIds"],
            )
        if plan["cacheKeys"]:
            placeholders = ",".join("?" for _item in plan["cacheKeys"])
            connection.execute(
                f"""
                DELETE FROM translation_cache
                WHERE cache_key IN ({placeholders})
                """,
                plan["cacheKeys"],
            )
        summary = {
            "skipped": False,
            "taskCount": plan["taskCount"],
            "taskRowCount": plan["taskRowCount"],
            "exportCount": plan["exportCount"],
            "cacheCount": plan["cacheCount"],
            "completedAt": now.isoformat(),
        }
        connection.execute(
            """
            INSERT INTO app_meta(key, value) VALUES('last_cleanup_at', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (now.isoformat(),),
        )
        connection.execute(
            """
            INSERT INTO app_meta(key, value)
            VALUES('last_cleanup_summary', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (
                json.dumps(
                    summary,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ),
        )
        return summary
