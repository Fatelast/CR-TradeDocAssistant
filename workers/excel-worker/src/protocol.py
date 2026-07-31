"""Worker JSON Lines 协议处理。"""

from __future__ import annotations

import json
import platform
import sqlite3
import sys
from dataclasses import dataclass
from typing import Any

from exporter import (
    ExportError,
    export_translation_task,
    preflight_export,
)
from glossary import (
    GlossaryError,
    apply_glossary_import,
    export_glossary,
    list_glossary_terms,
    preflight_glossary_import,
    upsert_glossary_term,
)
from history import (
    HistoryError,
    create_rerun_task,
    get_task_history_detail,
    list_task_history,
    recover_pending_exports,
    resolve_history_path,
)
from maintenance import (
    MaintenanceError,
    list_translation_cache,
    preview_data_cleanup,
    run_data_cleanup,
    run_scheduled_cleanup,
)
from settings import (
    SettingsError,
    export_app_settings,
    get_app_settings,
    update_app_settings,
)
from workbook import (
    WorkbookError,
    build_import_rows,
    parse_workbook,
    preview_sheet,
)
from tasks import (
    TaskError,
    change_translation_task_state,
    create_translation_task,
    get_translation_task,
    list_translation_tasks,
    process_translation_batch,
    review_translation_row,
    update_translation_row,
)

PROTOCOL_VERSION = "1.0"
WORKER_VERSION = "0.6.0-beta.1"


@dataclass(frozen=True)
class ProtocolError(Exception):
    """表示可安全返回给桌面端的稳定协议错误。"""

    code: str
    message: str
    request_id: str = "unknown"


def _error_response(error: ProtocolError) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "id": error.request_id,
        "type": "error",
        "error": {
            "code": error.code,
            "message": error.message,
        },
    }


def _completed_response(request_id: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "id": request_id,
        "type": "completed",
        "data": data,
    }


def _validate_request(message: Any) -> dict[str, Any]:
    if not isinstance(message, dict):
        raise ProtocolError("INVALID_MESSAGE", "请求必须是 JSON 对象")

    request_id = message.get("id")
    if not isinstance(request_id, str) or not request_id.strip():
        raise ProtocolError("INVALID_MESSAGE", "请求 ID 不能为空")

    if message.get("protocolVersion") != PROTOCOL_VERSION:
        raise ProtocolError(
            "PROTOCOL_VERSION_UNSUPPORTED",
            "不支持的协议版本",
            request_id,
        )

    if message.get("type") != "request":
        raise ProtocolError(
            "INVALID_MESSAGE",
            "消息类型必须为 request",
            request_id,
        )

    if not isinstance(message.get("payload"), dict):
        raise ProtocolError(
            "INVALID_MESSAGE",
            "payload 必须是 JSON 对象",
            request_id,
        )

    return message


def _get_worker_info() -> dict[str, Any]:
    return {
        "workerVersion": WORKER_VERSION,
        "protocolVersion": PROTOCOL_VERSION,
        "pythonVersion": platform.python_version(),
        "platform": sys.platform,
    }


def _handle_action(action: Any, payload: dict[str, Any]) -> dict[str, Any]:
    if action == "get_worker_info":
        return _get_worker_info()
    if action == "parse_workbook":
        return parse_workbook(payload.get("filePath"))
    if action == "preview_sheet":
        return preview_sheet(
            payload.get("filePath"),
            payload.get("sheetName"),
            payload.get("headerRow"),
        )
    if action == "build_import_rows":
        return build_import_rows(
            payload.get("filePath"),
            payload.get("sheetName"),
            payload.get("headerRow"),
            payload.get("sourceColumn"),
            payload.get("containerColumn"),
            payload.get("targetColumn"),
        )
    if action == "create_translation_task":
        return create_translation_task(payload)
    if action == "get_translation_task":
        return get_translation_task(payload)
    if action == "list_translation_tasks":
        return list_translation_tasks(payload)
    if action == "process_translation_batch":
        return process_translation_batch(payload)
    if action == "update_translation_row":
        return update_translation_row(payload)
    if action == "change_translation_task_state":
        return change_translation_task_state(payload)
    if action == "review_translation_row":
        return review_translation_row(payload)
    if action == "preflight_export":
        return preflight_export(payload)
    if action == "export_translation_task":
        return export_translation_task(payload)
    if action == "upsert_glossary_term":
        return upsert_glossary_term(payload)
    if action == "list_glossary_terms":
        return list_glossary_terms(payload)
    if action == "preflight_glossary_import":
        return preflight_glossary_import(payload)
    if action == "apply_glossary_import":
        return apply_glossary_import(payload)
    if action == "export_glossary":
        return export_glossary(payload)
    if action == "list_task_history":
        return list_task_history(payload)
    if action == "get_task_history_detail":
        return get_task_history_detail(payload)
    if action == "create_rerun_task":
        return create_rerun_task(payload)
    if action == "resolve_history_path":
        return resolve_history_path(payload)
    if action == "recover_pending_exports":
        return recover_pending_exports(payload)
    if action == "list_translation_cache":
        return list_translation_cache(payload)
    if action == "preview_data_cleanup":
        return preview_data_cleanup(payload)
    if action == "run_data_cleanup":
        return run_data_cleanup(payload)
    if action == "run_scheduled_cleanup":
        return run_scheduled_cleanup(payload)
    if action == "get_app_settings":
        return get_app_settings(payload)
    if action == "update_app_settings":
        return update_app_settings(payload)
    if action == "export_app_settings":
        return export_app_settings(payload)

    raise ProtocolError("UNSUPPORTED_ACTION", "不支持的 Worker 指令")


def handle_line(raw_line: str) -> dict[str, Any]:
    """解析并执行一条协议消息，始终返回可序列化响应。"""

    try:
        message = json.loads(raw_line)
    except json.JSONDecodeError:
        return _error_response(
            ProtocolError("INVALID_MESSAGE", "消息不是有效 JSON")
        )

    try:
        request = _validate_request(message)
        data = _handle_action(request.get("action"), request["payload"])
        return _completed_response(request["id"], data)
    except (
        WorkbookError,
        TaskError,
        ExportError,
        GlossaryError,
        HistoryError,
        MaintenanceError,
        SettingsError,
    ) as error:
        request_id = (
            message.get("id", "unknown")
            if isinstance(message, dict)
            else "unknown"
        )
        return _error_response(
            ProtocolError(error.code, error.message, request_id)
        )
    except sqlite3.Error:
        request_id = (
            message.get("id", "unknown")
            if isinstance(message, dict)
            else "unknown"
        )
        return _error_response(
            ProtocolError(
                "DATABASE_ERROR",
                "本地任务数据库操作失败",
                request_id,
            )
        )
    except ProtocolError as error:
        request_id = (
            message.get("id", "unknown")
            if isinstance(message, dict)
            else "unknown"
        )
        return _error_response(
            ProtocolError(error.code, error.message, request_id)
        )
    except Exception:
        request_id = (
            message.get("id", "unknown")
            if isinstance(message, dict)
            else "unknown"
        )
        return _error_response(
            ProtocolError(
                "WORKER_INTERNAL_ERROR",
                "Worker 内部错误",
                request_id,
            )
        )
