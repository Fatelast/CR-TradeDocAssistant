"""Worker JSON Lines 协议处理。"""

from __future__ import annotations

import json
import platform
import sys
from dataclasses import dataclass
from typing import Any

from workbook import (
    WorkbookError,
    build_import_rows,
    parse_workbook,
    preview_sheet,
)

PROTOCOL_VERSION = "1.0"
WORKER_VERSION = "0.2.0"


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
    except WorkbookError as error:
        request_id = (
            message.get("id", "unknown")
            if isinstance(message, dict)
            else "unknown"
        )
        return _error_response(
            ProtocolError(error.code, error.message, request_id)
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
