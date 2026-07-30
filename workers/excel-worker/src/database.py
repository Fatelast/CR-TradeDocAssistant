"""M2 本地 SQLite 数据库与版本化迁移。"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 1


def resolve_database_path() -> Path:
    configured = os.environ.get("RUS_TRADE_DATA_DIR")
    data_directory = (
        Path(configured).expanduser()
        if configured
        else Path.home() / ".cr-trade-doc-assistant"
    )
    data_directory.mkdir(parents=True, exist_ok=True)
    return data_directory / "trade-assistant.sqlite3"


def _migrate(connection: sqlite3.Connection) -> None:
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version > SCHEMA_VERSION:
        raise sqlite3.DatabaseError("数据库版本高于当前应用支持范围")
    if version == SCHEMA_VERSION:
        return

    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            source_file_path TEXT NOT NULL,
            source_file_name TEXT NOT NULL,
            sheet_name TEXT NOT NULL,
            header_row INTEGER NOT NULL,
            source_column INTEGER NOT NULL,
            container_column INTEGER,
            target_column INTEGER,
            source_language TEXT NOT NULL,
            target_language TEXT NOT NULL,
            translator_id TEXT NOT NULL,
            glossary_version INTEGER NOT NULL,
            protection_version TEXT NOT NULL,
            status TEXT NOT NULL,
            total_rows INTEGER NOT NULL DEFAULT 0,
            pending_rows INTEGER NOT NULL DEFAULT 0,
            candidate_rows INTEGER NOT NULL DEFAULT 0,
            manual_rows INTEGER NOT NULL DEFAULT 0,
            completed_rows INTEGER NOT NULL DEFAULT 0,
            failed_rows INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_rows (
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            row_id TEXT NOT NULL,
            excel_row_number INTEGER NOT NULL,
            source_cell TEXT NOT NULL,
            target_cell TEXT,
            container_cell TEXT,
            container_value_json TEXT,
            source_text TEXT NOT NULL,
            existing_target_json TEXT,
            translation TEXT,
            candidate_source TEXT,
            status TEXT NOT NULL,
            error_code TEXT,
            user_modified INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (task_id, row_id)
        );
        CREATE INDEX IF NOT EXISTS idx_task_rows_status
            ON task_rows(task_id, status);
        CREATE TABLE IF NOT EXISTS glossary_terms (
            id TEXT PRIMARY KEY,
            source_text TEXT NOT NULL,
            target_text TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '通用',
            exact_match INTEGER NOT NULL DEFAULT 1,
            case_sensitive INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            note TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_glossary_enabled
            ON glossary_terms(enabled, source_text);
        CREATE TABLE IF NOT EXISTS translation_cache (
            cache_key TEXT PRIMARY KEY,
            source_text TEXT NOT NULL,
            translation TEXT NOT NULL,
            source_language TEXT NOT NULL,
            target_language TEXT NOT NULL,
            translator_id TEXT NOT NULL,
            glossary_version INTEGER NOT NULL,
            protection_version TEXT NOT NULL,
            confirmed_at TEXT NOT NULL,
            last_used_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        """
    )
    connection.execute(
        "INSERT OR IGNORE INTO app_meta(key, value) VALUES('glossary_version', '1')"
    )
    connection.executemany(
        """
        INSERT OR IGNORE INTO glossary_terms(
            id, source_text, target_text, category, exact_match,
            case_sensitive, enabled, note, created_at, updated_at
        ) VALUES(?, ?, ?, '物流', 0, 0, 1, 'M2 内置基础术语', ?, ?)
        """,
        [
            (
                term_id,
                source,
                target,
                "2026-07-30T00:00:00+00:00",
                "2026-07-30T00:00:00+00:00",
            )
            for term_id, source, target in (
                ("builtin-external-package", "внешняя упаковка", "外包装"),
                ("builtin-label", "маркировка", "标签"),
                ("builtin-container", "контейнер", "集装箱"),
                ("builtin-document", "документ", "单据"),
                ("builtin-invoice", "инвойс", "发票"),
            )
        ],
    )
    connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    connection.commit()


@contextmanager
def connect_database() -> Iterator[sqlite3.Connection]:
    """打开单次 Worker 数据操作连接，并确保迁移完成。"""

    connection = sqlite3.connect(resolve_database_path(), timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    try:
        _migrate(connection)
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
