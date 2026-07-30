"""M2—M3 离线翻译任务、审核、术语、缓存与恢复服务。"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from database import connect_database
from exporter import calculate_file_fingerprint
from translation import (
    PROTECTION_VERSION,
    ProtectionError,
    match_glossary,
)
from workbook import build_import_rows, parse_workbook

TRANSLATOR_ID = "glossary-manual-v1"
DEFAULT_BATCH_SIZE = 50
MAX_BATCH_SIZE = 200
CACHE_RETENTION_DAYS = 180


@dataclass
class TaskError(Exception):
    """可映射到稳定 Worker 错误码的任务异常。"""

    code: str
    message: str


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _require_text(value: Any, code: str, message: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TaskError(code, message)
    return value.strip()


def _require_positive_int(value: Any, code: str, message: str) -> int:
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or value < 1
    ):
        raise TaskError(code, message)
    return value


def _optional_positive_int(
    value: Any,
    code: str,
    message: str,
) -> int | None:
    if value is None:
        return None
    return _require_positive_int(value, code, message)


def _encode_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _decode_value(value: str | None) -> Any:
    if value is None:
        return None
    return json.loads(value)


def _get_glossary_version(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        "SELECT value FROM app_meta WHERE key = 'glossary_version'"
    ).fetchone()
    return int(row["value"]) if row else 1


def _increment_glossary_version(connection: sqlite3.Connection) -> int:
    version = _get_glossary_version(connection) + 1
    connection.execute(
        """
        INSERT INTO app_meta(key, value) VALUES('glossary_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (str(version),),
    )
    return version


def _task_row_counts(
    connection: sqlite3.Connection,
    task_id: str,
) -> dict[str, int]:
    rows = connection.execute(
        """
        SELECT status, COUNT(*) AS count
        FROM task_rows
        WHERE task_id = ?
        GROUP BY status
        """,
        (task_id,),
    ).fetchall()
    counts = {row["status"]: int(row["count"]) for row in rows}
    return {
        "pending": counts.get("pending", 0),
        "candidate": counts.get("candidate", 0),
        "needs_manual": counts.get("needs_manual", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "ignored": counts.get("ignored", 0),
    }


def _automatic_task_status(counts: dict[str, int]) -> str:
    if counts["pending"] > 0:
        return "running"
    if (
        counts["candidate"] > 0
        or counts["needs_manual"] > 0
        or counts["failed"] > 0
    ):
        return "awaiting_manual"
    return "completed"


def _refresh_task(
    connection: sqlite3.Connection,
    task_id: str,
    forced_status: str | None = None,
) -> None:
    counts = _task_row_counts(connection, task_id)
    current = connection.execute(
        "SELECT status FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if current is None:
        raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")

    status = forced_status
    if status is None:
        status = (
            "cancelled"
            if current["status"] == "cancelled"
            else _automatic_task_status(counts)
        )
    connection.execute(
        """
        UPDATE tasks
        SET status = ?,
            pending_rows = ?,
            candidate_rows = ?,
            manual_rows = ?,
            completed_rows = ?,
            failed_rows = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            status,
            counts["pending"],
            counts["candidate"],
            counts["needs_manual"],
            counts["completed"] + counts["ignored"],
            counts["failed"],
            _now(),
            task_id,
        ),
    )


def _serialize_task(row: sqlite3.Row) -> dict[str, Any]:
    total_rows = int(row["total_rows"])
    completed_rows = int(row["completed_rows"])
    return {
        "taskId": row["id"],
        "sourceFilePath": row["source_file_path"],
        "sourceFileName": row["source_file_name"],
        "sheetName": row["sheet_name"],
        "headerRow": int(row["header_row"]),
        "sourceColumn": int(row["source_column"]),
        "containerColumn": row["container_column"],
        "targetColumn": row["target_column"],
        "sourceLanguage": row["source_language"],
        "targetLanguage": row["target_language"],
        "translatorId": row["translator_id"],
        "glossaryVersion": int(row["glossary_version"]),
        "protectionVersion": row["protection_version"],
        "sourceFingerprintAvailable": bool(row["source_file_sha256"]),
        "sourceRestricted": bool(row["source_restricted"]),
        "sourceRisks": _decode_value(row["source_risks_json"]),
        "status": row["status"],
        "totalRows": total_rows,
        "pendingRows": int(row["pending_rows"]),
        "candidateRows": int(row["candidate_rows"]),
        "manualRows": int(row["manual_rows"]),
        "completedRows": completed_rows,
        "failedRows": int(row["failed_rows"]),
        "progress": (
            round(completed_rows / total_rows, 4)
            if total_rows
            else 0
        ),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _serialize_task_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "rowId": row["row_id"],
        "excelRowNumber": int(row["excel_row_number"]),
        "sourceCell": row["source_cell"],
        "targetCell": row["target_cell"],
        "containerCell": row["container_cell"],
        "containerValue": _decode_value(row["container_value_json"]),
        "sourceText": row["source_text"],
        "existingTarget": _decode_value(row["existing_target_json"]),
        "translation": row["translation"],
        "initialTranslation": row["initial_translation"],
        "candidateSource": row["candidate_source"],
        "initialCandidateSource": row["initial_candidate_source"],
        "status": row["status"],
        "errorCode": row["error_code"],
        "userModified": bool(row["user_modified"]),
        "updatedAt": row["updated_at"],
    }


def _task_detail(
    connection: sqlite3.Connection,
    task_id: str,
) -> dict[str, Any]:
    task = connection.execute(
        "SELECT * FROM tasks WHERE id = ?",
        (task_id,),
    ).fetchone()
    if task is None:
        raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")
    rows = connection.execute(
        """
        SELECT *
        FROM task_rows
        WHERE task_id = ?
        ORDER BY excel_row_number, row_id
        """,
        (task_id,),
    ).fetchall()
    return {
        "task": _serialize_task(task),
        "rows": [_serialize_task_row(row) for row in rows],
    }


def create_translation_task(payload: dict[str, Any]) -> dict[str, Any]:
    """从 M1 工作簿配置重新生成可信行映射并创建本地任务。"""

    file_path = _require_text(
        payload.get("filePath"),
        "INVALID_MESSAGE",
        "源文件路径不能为空",
    )
    sheet_name = _require_text(
        payload.get("sheetName"),
        "INVALID_MESSAGE",
        "工作表不能为空",
    )
    header_row = _require_positive_int(
        payload.get("headerRow"),
        "INVALID_MESSAGE",
        "表头行无效",
    )
    source_column = _require_positive_int(
        payload.get("sourceColumn"),
        "SOURCE_COLUMN_INVALID",
        "原文列无效",
    )
    container_column = _optional_positive_int(
        payload.get("containerColumn"),
        "SOURCE_COLUMN_INVALID",
        "箱号列无效",
    )
    target_column = _optional_positive_int(
        payload.get("targetColumn"),
        "TARGET_COLUMN_INVALID",
        "译文列无效",
    )
    import_result = build_import_rows(
        file_path,
        sheet_name,
        header_row,
        source_column,
        container_column,
        target_column,
    )
    if import_result["totalRows"] == 0:
        raise TaskError("TASK_ROWS_EMPTY", "没有可建立任务的原文数据")

    source_summary = parse_workbook(file_path)
    fingerprint = calculate_file_fingerprint(file_path)
    task_id = str(uuid4())
    created_at = _now()
    with connect_database() as connection:
        glossary_version = _get_glossary_version(connection)
        connection.execute(
            """
            INSERT INTO tasks(
                id, source_file_path, source_file_name, sheet_name,
                header_row, source_column, container_column, target_column,
                source_language, target_language, translator_id,
                glossary_version, protection_version, status, total_rows,
                pending_rows, candidate_rows, manual_rows, completed_rows,
                failed_rows, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?)
            """,
            (
                task_id,
                str(Path(file_path).resolve()),
                Path(file_path).name,
                import_result["sheetName"],
                header_row,
                source_column,
                container_column,
                target_column,
                payload.get("sourceLanguage", "ru"),
                payload.get("targetLanguage", "zh-CN"),
                TRANSLATOR_ID,
                glossary_version,
                PROTECTION_VERSION,
                "draft",
                import_result["totalRows"],
                import_result["totalRows"],
                created_at,
                created_at,
            ),
        )
        connection.execute(
            """
            UPDATE tasks
            SET source_file_sha256 = ?, source_file_size_bytes = ?,
                source_file_mtime_ns = ?, source_restricted = ?,
                source_risks_json = ?
            WHERE id = ?
            """,
            (
                fingerprint["sha256"],
                fingerprint["sizeBytes"],
                fingerprint["mtimeNs"],
                int(source_summary["restricted"]),
                _encode_value(source_summary["risks"]),
                task_id,
            ),
        )
        for item in import_result["rows"]:
            existing_target = item["existingTarget"]
            has_existing_target = (
                existing_target is not None
                and str(existing_target).strip() != ""
            )
            connection.execute(
                """
                INSERT INTO task_rows(
                    task_id, row_id, excel_row_number, source_cell,
                    target_cell, container_cell, container_value_json,
                    source_text, existing_target_json, translation,
                    candidate_source, status, error_code, user_modified,
                    created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
                """,
                (
                    task_id,
                    item["rowId"],
                    item["excelRowNumber"],
                    item["sourceCell"],
                    item["targetCell"],
                    item["containerCell"],
                    _encode_value(item["containerValue"]),
                    item["sourceText"],
                    _encode_value(existing_target),
                    str(existing_target) if has_existing_target else None,
                    "existing" if has_existing_target else None,
                    "completed" if has_existing_target else "pending",
                    created_at,
                    created_at,
                ),
            )
            if has_existing_target:
                connection.execute(
                    """
                    UPDATE task_rows
                    SET initial_translation = ?,
                        initial_candidate_source = 'existing'
                    WHERE task_id = ? AND row_id = ?
                    """,
                    (str(existing_target), task_id, item["rowId"]),
                )
        _refresh_task(connection, task_id, "draft")
        return _task_detail(connection, task_id)


def get_translation_task(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = _require_text(
        payload.get("taskId"),
        "INVALID_MESSAGE",
        "任务 ID 不能为空",
    )
    with connect_database() as connection:
        return _task_detail(connection, task_id)


def list_translation_tasks(payload: dict[str, Any]) -> dict[str, Any]:
    include_completed = payload.get("includeCompleted") is True
    limit = payload.get("limit", 20)
    if (
        not isinstance(limit, int)
        or isinstance(limit, bool)
        or limit < 1
        or limit > 100
    ):
        raise TaskError("INVALID_MESSAGE", "任务列表数量无效")

    where_clause = "" if include_completed else (
        "WHERE status NOT IN ('completed', 'cancelled')"
    )
    with connect_database() as connection:
        tasks = connection.execute(
            f"""
            SELECT *
            FROM tasks
            {where_clause}
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return {"tasks": [_serialize_task(task) for task in tasks]}


def _load_glossary_terms(
    connection: sqlite3.Connection,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM glossary_terms
        WHERE enabled = 1
        ORDER BY length(source_text) DESC, source_text
        """
    ).fetchall()
    return [
        {
            "termId": row["id"],
            "sourceText": row["source_text"],
            "targetText": row["target_text"],
            "category": row["category"],
            "exactMatch": bool(row["exact_match"]),
            "caseSensitive": bool(row["case_sensitive"]),
            "enabled": bool(row["enabled"]),
            "note": row["note"],
        }
        for row in rows
    ]


def _build_cache_key(
    source_text: str,
    task: sqlite3.Row,
) -> str:
    key_data = {
        "sourceText": source_text,
        "sourceLanguage": task["source_language"],
        "targetLanguage": task["target_language"],
        "translatorId": task["translator_id"],
        "glossaryVersion": int(task["glossary_version"]),
        "protectionVersion": task["protection_version"],
    }
    serialized = json.dumps(
        key_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _lookup_cache(
    connection: sqlite3.Connection,
    source_text: str,
    task: sqlite3.Row,
) -> str | None:
    cache_key = _build_cache_key(source_text, task)
    row = connection.execute(
        """
        SELECT translation
        FROM translation_cache
        WHERE cache_key = ? AND expires_at > ?
        """,
        (cache_key, _now()),
    ).fetchone()
    if row is None:
        return None
    connection.execute(
        "UPDATE translation_cache SET last_used_at = ? WHERE cache_key = ?",
        (_now(), cache_key),
    )
    return str(row["translation"])


def _save_cache(
    connection: sqlite3.Connection,
    source_text: str,
    translation: str,
    task: sqlite3.Row,
) -> None:
    confirmed_at = datetime.now(timezone.utc).replace(microsecond=0)
    expires_at = confirmed_at + timedelta(days=CACHE_RETENTION_DAYS)
    connection.execute(
        """
        INSERT INTO translation_cache(
            cache_key, source_text, translation, source_language,
            target_language, translator_id, glossary_version,
            protection_version, confirmed_at, last_used_at, expires_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            translation = excluded.translation,
            confirmed_at = excluded.confirmed_at,
            last_used_at = excluded.last_used_at,
            expires_at = excluded.expires_at
        """,
        (
            _build_cache_key(source_text, task),
            source_text,
            translation,
            task["source_language"],
            task["target_language"],
            task["translator_id"],
            int(task["glossary_version"]),
            task["protection_version"],
            confirmed_at.isoformat(),
            confirmed_at.isoformat(),
            expires_at.isoformat(),
        ),
    )


def _match_translation_row(
    connection: sqlite3.Connection,
    task: sqlite3.Row,
    row: sqlite3.Row,
    terms: list[dict[str, Any]],
    reset_initial: bool = False,
) -> None:
    translation: str | None = None
    candidate_source: str | None = None
    status = "needs_manual"
    error_code: str | None = None
    try:
        translation = _lookup_cache(connection, row["source_text"], task)
        if translation is not None:
            candidate_source = "cache"
            status = "candidate"
        else:
            translation = match_glossary(row["source_text"], terms)
            if translation is not None:
                candidate_source = "glossary"
                status = "candidate"
            else:
                candidate_source = "manual"
    except ProtectionError:
        status = "failed"
        error_code = "TOKEN_RESTORE_FAILED"

    initial_translation = (
        translation
        if reset_initial or row["initial_translation"] is None
        else row["initial_translation"]
    )
    initial_candidate_source = (
        candidate_source
        if reset_initial or row["initial_candidate_source"] is None
        else row["initial_candidate_source"]
    )
    connection.execute(
        """
        UPDATE task_rows
        SET translation = ?, initial_translation = ?,
            candidate_source = ?, initial_candidate_source = ?,
            status = ?, error_code = ?, user_modified = 0,
            updated_at = ?
        WHERE task_id = ? AND row_id = ?
        """,
        (
            translation,
            initial_translation,
            candidate_source,
            initial_candidate_source,
            status,
            error_code,
            _now(),
            task["id"],
            row["row_id"],
        ),
    )


def process_translation_batch(payload: dict[str, Any]) -> dict[str, Any]:
    """同步处理一个小批次，供 Renderer 在批次之间实现可靠暂停。"""

    task_id = _require_text(
        payload.get("taskId"),
        "INVALID_MESSAGE",
        "任务 ID 不能为空",
    )
    batch_size = payload.get("batchSize", DEFAULT_BATCH_SIZE)
    if (
        not isinstance(batch_size, int)
        or isinstance(batch_size, bool)
        or batch_size < 1
        or batch_size > MAX_BATCH_SIZE
    ):
        raise TaskError("INVALID_MESSAGE", "批次大小无效")

    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")
        if task["status"] == "cancelled":
            raise TaskError("TASK_STATE_INVALID", "已中止任务不能继续处理")
        if task["status"] == "completed":
            return _task_detail(connection, task_id)

        connection.execute(
            "UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?",
            (_now(), task_id),
        )
        terms = _load_glossary_terms(connection)
        rows = connection.execute(
            """
            SELECT *
            FROM task_rows
            WHERE task_id = ? AND status = 'pending'
            ORDER BY excel_row_number, row_id
            LIMIT ?
            """,
            (task_id, batch_size),
        ).fetchall()

        for row in rows:
            _match_translation_row(connection, task, row, terms)

        _refresh_task(connection, task_id)
        return _task_detail(connection, task_id)


def update_translation_row(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = _require_text(
        payload.get("taskId"),
        "INVALID_MESSAGE",
        "任务 ID 不能为空",
    )
    row_id = _require_text(
        payload.get("rowId"),
        "INVALID_MESSAGE",
        "行任务 ID 不能为空",
    )
    translation = _require_text(
        payload.get("translation"),
        "TRANSLATION_OUTPUT_INVALID",
        "译文不能为空",
    )
    save_to_cache = payload.get("saveToCache") is True

    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")
        if task["status"] == "cancelled":
            raise TaskError("TASK_STATE_INVALID", "已中止任务不能修改")
        row = connection.execute(
            """
            SELECT *
            FROM task_rows
            WHERE task_id = ? AND row_id = ?
            """,
            (task_id, row_id),
        ).fetchone()
        if row is None:
            raise TaskError("TASK_ROW_NOT_FOUND", "翻译任务行不存在")

        connection.execute(
            """
            UPDATE task_rows
            SET translation = ?,
                candidate_source = 'manual',
                status = 'completed',
                error_code = NULL,
                user_modified = 1,
                updated_at = ?
            WHERE task_id = ? AND row_id = ?
            """,
            (translation, _now(), task_id, row_id),
        )
        if save_to_cache:
            _save_cache(connection, row["source_text"], translation, task)
        _refresh_task(connection, task_id)
        return _task_detail(connection, task_id)


def review_translation_row(payload: dict[str, Any]) -> dict[str, Any]:
    """执行忽略、恢复初始候选或单行离线重新匹配。"""

    task_id = _require_text(
        payload.get("taskId"),
        "INVALID_MESSAGE",
        "任务 ID 不能为空",
    )
    row_id = _require_text(
        payload.get("rowId"),
        "INVALID_MESSAGE",
        "行任务 ID 不能为空",
    )
    action = _require_text(
        payload.get("action"),
        "INVALID_MESSAGE",
        "审核操作不能为空",
    )
    if action not in {"ignore", "restore_initial", "rematch"}:
        raise TaskError("INVALID_MESSAGE", "不支持的审核操作")

    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")
        if task["status"] == "cancelled":
            raise TaskError("TASK_STATE_INVALID", "已中止任务不能审核")
        row = connection.execute(
            """
            SELECT * FROM task_rows
            WHERE task_id = ? AND row_id = ?
            """,
            (task_id, row_id),
        ).fetchone()
        if row is None:
            raise TaskError("TASK_ROW_NOT_FOUND", "翻译任务行不存在")

        if action == "ignore":
            connection.execute(
                """
                UPDATE task_rows
                SET status = 'ignored', error_code = NULL,
                    user_modified = 1, updated_at = ?
                WHERE task_id = ? AND row_id = ?
                """,
                (_now(), task_id, row_id),
            )
        elif action == "restore_initial":
            initial_translation = row["initial_translation"]
            initial_source = row["initial_candidate_source"]
            if not initial_translation or not initial_source:
                raise TaskError(
                    "INITIAL_TRANSLATION_MISSING",
                    "该行没有可恢复的初始候选",
                )
            restored_status = (
                "completed" if initial_source == "existing" else "candidate"
            )
            connection.execute(
                """
                UPDATE task_rows
                SET translation = ?, candidate_source = ?, status = ?,
                    error_code = NULL, user_modified = 0, updated_at = ?
                WHERE task_id = ? AND row_id = ?
                """,
                (
                    initial_translation,
                    initial_source,
                    restored_status,
                    _now(),
                    task_id,
                    row_id,
                ),
            )
        else:
            glossary_version = _get_glossary_version(connection)
            connection.execute(
                """
                UPDATE tasks
                SET glossary_version = ?, updated_at = ?
                WHERE id = ?
                """,
                (glossary_version, _now(), task_id),
            )
            task = connection.execute(
                "SELECT * FROM tasks WHERE id = ?",
                (task_id,),
            ).fetchone()
            terms = _load_glossary_terms(connection)
            _match_translation_row(
                connection,
                task,
                row,
                terms,
                reset_initial=True,
            )

        _refresh_task(connection, task_id)
        return _task_detail(connection, task_id)


def change_translation_task_state(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = _require_text(
        payload.get("taskId"),
        "INVALID_MESSAGE",
        "任务 ID 不能为空",
    )
    action = _require_text(
        payload.get("action"),
        "INVALID_MESSAGE",
        "任务操作不能为空",
    )
    if action not in {"pause", "resume", "cancel", "retry_failed"}:
        raise TaskError("INVALID_MESSAGE", "不支持的任务操作")

    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise TaskError("TASK_NOT_FOUND", "翻译任务不存在")
        if task["status"] == "cancelled" and action != "cancel":
            raise TaskError("TASK_STATE_INVALID", "已中止任务不能继续操作")

        if action == "cancel":
            _refresh_task(connection, task_id, "cancelled")
        elif action == "pause":
            _refresh_task(connection, task_id, "paused")
        elif action == "retry_failed":
            connection.execute(
                """
                UPDATE task_rows
                SET status = 'pending', error_code = NULL, updated_at = ?
                WHERE task_id = ? AND status = 'failed'
                """,
                (_now(), task_id),
            )
            _refresh_task(connection, task_id, "paused")
        else:
            counts = _task_row_counts(connection, task_id)
            status = (
                "running"
                if counts["pending"] > 0
                else _automatic_task_status(counts)
            )
            _refresh_task(connection, task_id, status)
        return _task_detail(connection, task_id)


def upsert_glossary_term(payload: dict[str, Any]) -> dict[str, Any]:
    source_text = _require_text(
        payload.get("sourceText"),
        "INVALID_MESSAGE",
        "术语原文不能为空",
    )
    target_text = _require_text(
        payload.get("targetText"),
        "INVALID_MESSAGE",
        "术语译文不能为空",
    )
    term_id = payload.get("termId")
    if term_id is not None:
        term_id = _require_text(term_id, "INVALID_MESSAGE", "术语 ID 无效")
    else:
        term_id = str(uuid4())
    now = _now()

    with connect_database() as connection:
        existing = connection.execute(
            "SELECT id FROM glossary_terms WHERE id = ?",
            (term_id,),
        ).fetchone()
        if existing:
            connection.execute(
                """
                UPDATE glossary_terms
                SET source_text = ?, target_text = ?, category = ?,
                    exact_match = ?, case_sensitive = ?, enabled = ?,
                    note = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    source_text,
                    target_text,
                    str(payload.get("category") or "通用"),
                    int(payload.get("exactMatch") is not False),
                    int(payload.get("caseSensitive") is True),
                    int(payload.get("enabled") is not False),
                    payload.get("note"),
                    now,
                    term_id,
                ),
            )
        else:
            connection.execute(
                """
                INSERT INTO glossary_terms(
                    id, source_text, target_text, category, exact_match,
                    case_sensitive, enabled, note, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    term_id,
                    source_text,
                    target_text,
                    str(payload.get("category") or "通用"),
                    int(payload.get("exactMatch") is not False),
                    int(payload.get("caseSensitive") is True),
                    int(payload.get("enabled") is not False),
                    payload.get("note"),
                    now,
                    now,
                ),
            )
        version = _increment_glossary_version(connection)
        return {"termId": term_id, "glossaryVersion": version}


def list_glossary_terms(_payload: dict[str, Any]) -> dict[str, Any]:
    with connect_database() as connection:
        return {
            "glossaryVersion": _get_glossary_version(connection),
            "terms": _load_glossary_terms(connection),
        }
