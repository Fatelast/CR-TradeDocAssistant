"""M4 本地应用设置。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from database import connect_database

TASK_RETENTION_DAYS = 90
CACHE_RETENTION_DAYS = 180
LOG_RETENTION_DAYS = 30


@dataclass
class SettingsError(Exception):
    code: str
    message: str


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _serialize_settings(row: Any) -> dict[str, Any]:
    return {
        "defaultOutputDirectory": row["default_output_directory"],
        "batchSize": int(row["batch_size"]),
        "logLevel": row["log_level"],
        "retention": {
            "taskDays": TASK_RETENTION_DAYS,
            "cacheDays": CACHE_RETENTION_DAYS,
            "logDays": LOG_RETENTION_DAYS,
        },
        "updatedAt": row["updated_at"],
    }


def get_app_settings(_payload: dict[str, Any]) -> dict[str, Any]:
    with connect_database() as connection:
        row = connection.execute(
            "SELECT * FROM app_settings WHERE id = 1"
        ).fetchone()
        if row is None:
            raise SettingsError("DATABASE_ERROR", "本地设置不存在")
        return _serialize_settings(row)


def update_app_settings(payload: dict[str, Any]) -> dict[str, Any]:
    batch_size = payload.get("batchSize")
    if (
        not isinstance(batch_size, int)
        or isinstance(batch_size, bool)
        or batch_size < 1
        or batch_size > 200
    ):
        raise SettingsError("SETTINGS_INVALID", "批次大小必须为 1～200")

    log_level = payload.get("logLevel")
    if log_level not in {"info", "error"}:
        raise SettingsError("SETTINGS_INVALID", "日志级别无效")

    output_directory = payload.get("defaultOutputDirectory")
    if output_directory is not None:
        if not isinstance(output_directory, str) or not output_directory.strip():
            raise SettingsError("SETTINGS_INVALID", "默认输出目录无效")
        output_path = Path(output_directory).expanduser()
        if not output_path.is_absolute() or not output_path.is_dir():
            raise SettingsError(
                "OUTPUT_DIRECTORY_UNAVAILABLE",
                "默认输出目录不存在或不可用",
            )
        output_directory = str(output_path.resolve())

    with connect_database() as connection:
        connection.execute(
            """
            UPDATE app_settings
            SET default_output_directory = ?,
                batch_size = ?,
                log_level = ?,
                updated_at = ?
            WHERE id = 1
            """,
            (output_directory, batch_size, log_level, _now()),
        )
        row = connection.execute(
            "SELECT * FROM app_settings WHERE id = 1"
        ).fetchone()
        if row is None:
            raise SettingsError("DATABASE_ERROR", "本地设置更新失败")
        return _serialize_settings(row)


def export_app_settings(payload: dict[str, Any]) -> dict[str, Any]:
    output_value = payload.get("outputPath")
    if not isinstance(output_value, str) or not output_value.strip():
        raise SettingsError("EXPORT_PATH_INVALID", "设置导出路径不能为空")
    output_path = Path(output_value).expanduser()
    if not output_path.is_absolute() or output_path.suffix.lower() != ".json":
        raise SettingsError("EXPORT_PATH_INVALID", "设置只能导出为 JSON")
    if output_path.exists():
        raise SettingsError("EXPORT_PATH_EXISTS", "设置导出文件已存在")
    if not output_path.parent.is_dir():
        raise SettingsError("EXPORT_PATH_INVALID", "设置导出目录不存在")

    content = {
        "format": "cr-trade-settings",
        "formatVersion": 1,
        "exportedAt": _now(),
        "settings": get_app_settings({}),
    }
    temp_path = output_path.with_name(
        f".{output_path.stem}.{uuid4().hex}.tmp.json"
    )
    try:
        temp_path.write_text(
            json.dumps(content, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        json.loads(temp_path.read_text(encoding="utf-8"))
        temp_path.replace(output_path)
    except OSError as error:
        raise SettingsError("EXPORT_WRITE_FAILED", "设置导出失败") from error
    finally:
        temp_path.unlink(missing_ok=True)

    return {
        "outputPath": str(output_path),
        "outputFileName": output_path.name,
        "validated": True,
    }
