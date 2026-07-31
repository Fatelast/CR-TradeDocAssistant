"""M4 任务与导出历史。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from database import connect_database
from exporter import calculate_file_fingerprint
from tasks import _serialize_task, create_translation_task

ALLOWED_STATUSES = {
    "draft",
    "running",
    "paused",
    "awaiting_manual",
    "completed",
    "cancelled",
}


@dataclass
class HistoryError(Exception):
    code: str
    message: str


def _serialize_export(row: Any) -> dict[str, Any]:
    output_path = Path(row["output_file_path"])
    return {
        "exportId": row["id"],
        "taskId": row["task_id"],
        "outputFilePath": row["output_file_path"],
        "outputFileName": row["output_file_name"],
        "outputSha256": row["output_file_sha256"],
        "status": row["status"],
        "sheetName": row["sheet_name"],
        "targetColumn": row["target_column"],
        "targetColumnLetter": row["target_column_letter"],
        "createdTargetColumn": bool(row["created_target_column"]),
        "writtenRows": int(row["written_rows"]),
        "skippedRows": int(row["skipped_rows"]),
        "validated": bool(row["validated"]),
        "errorCode": row["error_code"],
        "outputExists": output_path.is_file(),
        "createdAt": row["created_at"],
        "completedAt": row["completed_at"],
    }


def list_task_history(payload: dict[str, Any]) -> dict[str, Any]:
    page = payload.get("page", 1)
    page_size = payload.get("pageSize", 20)
    if (
        not isinstance(page, int)
        or isinstance(page, bool)
        or page < 1
        or not isinstance(page_size, int)
        or isinstance(page_size, bool)
        or page_size < 1
        or page_size > 50
    ):
        raise HistoryError("INVALID_MESSAGE", "历史分页参数无效")

    search = payload.get("search", "")
    if not isinstance(search, str) or len(search) > 100:
        raise HistoryError("INVALID_MESSAGE", "历史搜索条件无效")
    status = payload.get("status")
    if status is not None and status not in ALLOWED_STATUSES:
        raise HistoryError("INVALID_MESSAGE", "历史状态筛选无效")
    days = payload.get("days")
    if days not in {None, 7, 30, 90}:
        raise HistoryError("INVALID_MESSAGE", "历史时间筛选无效")

    clauses: list[str] = []
    parameters: list[Any] = []
    if search.strip():
        clauses.append("t.source_file_name LIKE ? ESCAPE '\\'")
        escaped = (
            search.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        parameters.append(f"%{escaped}%")
    if status:
        clauses.append("t.status = ?")
        parameters.append(status)
    if days is not None:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(days=days)
        ).replace(microsecond=0).isoformat()
        clauses.append("t.updated_at >= ?")
        parameters.append(cutoff)
    where_clause = (
        f"WHERE {' AND '.join(clauses)}"
        if clauses
        else ""
    )

    with connect_database() as connection:
        total = int(
            connection.execute(
                f"SELECT COUNT(*) AS count FROM tasks t {where_clause}",
                parameters,
            ).fetchone()["count"]
        )
        rows = connection.execute(
            f"""
            SELECT t.*,
                (
                    SELECT COUNT(*)
                    FROM task_exports e
                    WHERE e.task_id = t.id
                ) AS export_count,
                (
                    SELECT e.status
                    FROM task_exports e
                    WHERE e.task_id = t.id
                    ORDER BY e.created_at DESC, e.id DESC
                    LIMIT 1
                ) AS latest_export_status
            FROM tasks t
            {where_clause}
            ORDER BY t.updated_at DESC, t.id DESC
            LIMIT ? OFFSET ?
            """,
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()

    items = []
    for row in rows:
        item = _serialize_task(row)
        item.update(
            {
                "rerunOfTaskId": row["rerun_of_task_id"],
                "sourceExists": Path(row["source_file_path"]).is_file(),
                "exportCount": int(row["export_count"]),
                "latestExportStatus": row["latest_export_status"],
            }
        )
        items.append(item)
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "totalPages": max(1, (total + page_size - 1) // page_size),
    }


def get_task_history_detail(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = payload.get("taskId")
    if not isinstance(task_id, str) or not task_id.strip():
        raise HistoryError("INVALID_MESSAGE", "任务 ID 不能为空")
    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise HistoryError("HISTORY_TASK_NOT_FOUND", "历史任务不存在")
        exports = connection.execute(
            """
            SELECT *
            FROM task_exports
            WHERE task_id = ?
            ORDER BY created_at DESC, id DESC
            """,
            (task_id,),
        ).fetchall()
    summary = _serialize_task(task)
    summary["rerunOfTaskId"] = task["rerun_of_task_id"]
    return {
        "task": summary,
        "sourceExists": Path(task["source_file_path"]).is_file(),
        "exports": [_serialize_export(row) for row in exports],
    }


def create_rerun_task(payload: dict[str, Any]) -> dict[str, Any]:
    task_id = payload.get("taskId")
    if not isinstance(task_id, str) or not task_id.strip():
        raise HistoryError("INVALID_MESSAGE", "任务 ID 不能为空")
    with connect_database() as connection:
        task = connection.execute(
            "SELECT * FROM tasks WHERE id = ?",
            (task_id,),
        ).fetchone()
        if task is None:
            raise HistoryError("HISTORY_TASK_NOT_FOUND", "历史任务不存在")
        task_data = dict(task)

    source_path = Path(task_data["source_file_path"])
    if not source_path.is_file():
        raise HistoryError(
            "TASK_SOURCE_RESELECT_REQUIRED",
            "原文件不存在，请重新选择文件并确认结构",
        )
    if not task_data.get("source_file_sha256"):
        raise HistoryError(
            "TASK_SOURCE_RESELECT_REQUIRED",
            "历史任务缺少源文件指纹，请重新选择文件",
        )
    current = calculate_file_fingerprint(source_path)
    if (
        current["sha256"] != task_data["source_file_sha256"]
        or current["sizeBytes"] != task_data["source_file_size_bytes"]
    ):
        raise HistoryError(
            "TASK_SOURCE_RESELECT_REQUIRED",
            "原文件已变化，请重新选择文件并确认结构",
        )

    return create_translation_task(
        {
            "filePath": str(source_path),
            "sheetName": task_data["sheet_name"],
            "headerRow": int(task_data["header_row"]),
            "sourceColumn": int(task_data["source_column"]),
            "containerColumn": task_data["container_column"],
            "targetColumn": task_data["target_column"],
            "sourceLanguage": task_data["source_language"],
            "targetLanguage": task_data["target_language"],
            "rerunOfTaskId": task_id,
        }
    )


def resolve_history_path(payload: dict[str, Any]) -> dict[str, Any]:
    entity_type = payload.get("entityType")
    entity_id = payload.get("entityId")
    if entity_type not in {"source", "export"}:
        raise HistoryError("INVALID_MESSAGE", "历史路径类型无效")
    if not isinstance(entity_id, str) or not entity_id.strip():
        raise HistoryError("INVALID_MESSAGE", "历史记录 ID 不能为空")

    with connect_database() as connection:
        if entity_type == "source":
            row = connection.execute(
                """
                SELECT source_file_path AS path, source_file_name AS name
                FROM tasks WHERE id = ?
                """,
                (entity_id,),
            ).fetchone()
            missing_code = "HISTORY_TASK_NOT_FOUND"
        else:
            row = connection.execute(
                """
                SELECT output_file_path AS path, output_file_name AS name
                FROM task_exports WHERE id = ?
                """,
                (entity_id,),
            ).fetchone()
            missing_code = "EXPORT_RECORD_NOT_FOUND"
    if row is None:
        raise HistoryError(missing_code, "历史文件记录不存在")
    path = Path(row["path"])
    return {
        "path": str(path),
        "fileName": row["name"],
        "exists": path.is_file(),
    }


def recover_pending_exports(_payload: dict[str, Any]) -> dict[str, Any]:
    recovered = 0
    failed = 0
    with connect_database() as connection:
        rows = connection.execute(
            "SELECT * FROM task_exports WHERE status = 'pending'"
        ).fetchall()
        for row in rows:
            output_path = Path(row["output_file_path"])
            if output_path.is_file():
                fingerprint = calculate_file_fingerprint(output_path)
                connection.execute(
                    """
                    UPDATE task_exports
                    SET status = 'recovered',
                        output_file_sha256 = ?,
                        validated = 1,
                        completed_at = ?,
                        error_code = NULL
                    WHERE id = ?
                    """,
                    (
                        fingerprint["sha256"],
                        datetime.now(timezone.utc)
                        .replace(microsecond=0)
                        .isoformat(),
                        row["id"],
                    ),
                )
                recovered += 1
            else:
                connection.execute(
                    """
                    UPDATE task_exports
                    SET status = 'failed',
                        error_code = 'EXPORT_WRITE_FAILED',
                        completed_at = ?
                    WHERE id = ?
                    """,
                    (
                        datetime.now(timezone.utc)
                        .replace(microsecond=0)
                        .isoformat(),
                        row["id"],
                    ),
                )
                failed += 1
    return {"recovered": recovered, "failed": failed}
