"""M2—M4 本地 SQLite 数据库与版本化迁移。"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

SCHEMA_VERSION = 3


def build_glossary_term_key(
    source_text: str,
    exact_match: bool,
    case_sensitive: bool,
) -> str:
    """构造跨导入、编辑和迁移稳定的术语身份键。"""

    normalized_source = " ".join(source_text.strip().split())
    if not case_sensitive:
        normalized_source = normalized_source.casefold()
    serialized = json.dumps(
        {
            "sourceText": normalized_source,
            "exactMatch": exact_match,
            "caseSensitive": case_sensitive,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


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

    if version < 1:
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
            "INSERT OR IGNORE INTO app_meta(key, value) "
            "VALUES('glossary_version', '1')"
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
        connection.execute("PRAGMA user_version = 1")
        version = 1

    if version < 2:
        connection.executescript(
            """
            ALTER TABLE tasks ADD COLUMN source_file_sha256 TEXT;
            ALTER TABLE tasks ADD COLUMN source_file_size_bytes INTEGER;
            ALTER TABLE tasks ADD COLUMN source_file_mtime_ns INTEGER;
            ALTER TABLE tasks
                ADD COLUMN source_restricted INTEGER NOT NULL DEFAULT 0;
            ALTER TABLE tasks
                ADD COLUMN source_risks_json TEXT NOT NULL DEFAULT '[]';
            ALTER TABLE task_rows ADD COLUMN initial_translation TEXT;
            ALTER TABLE task_rows ADD COLUMN initial_candidate_source TEXT;
            UPDATE task_rows
            SET initial_translation = translation,
                initial_candidate_source = candidate_source
            WHERE translation IS NOT NULL;
            """
        )
        connection.execute("PRAGMA user_version = 2")
        version = 2

    if version < 3:
        connection.executescript(
            """
            ALTER TABLE tasks
                ADD COLUMN rerun_of_task_id TEXT
                    REFERENCES tasks(id) ON DELETE SET NULL;
            ALTER TABLE glossary_terms ADD COLUMN term_key TEXT;
            CREATE TABLE IF NOT EXISTS task_exports (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL
                    REFERENCES tasks(id) ON DELETE CASCADE,
                output_file_path TEXT NOT NULL,
                output_file_name TEXT NOT NULL,
                output_file_sha256 TEXT,
                status TEXT NOT NULL,
                sheet_name TEXT NOT NULL,
                target_column INTEGER,
                target_column_letter TEXT,
                created_target_column INTEGER NOT NULL DEFAULT 0,
                written_rows INTEGER NOT NULL DEFAULT 0,
                skipped_rows INTEGER NOT NULL DEFAULT 0,
                validated INTEGER NOT NULL DEFAULT 0,
                error_code TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_task_exports_task
                ON task_exports(task_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_task_exports_status
                ON task_exports(status, created_at);
            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                default_output_directory TEXT,
                batch_size INTEGER NOT NULL DEFAULT 50
                    CHECK(batch_size BETWEEN 1 AND 200),
                log_level TEXT NOT NULL DEFAULT 'info'
                    CHECK(log_level IN ('info', 'error')),
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_tasks_history
                ON tasks(updated_at DESC, id);
            CREATE INDEX IF NOT EXISTS idx_glossary_category
                ON glossary_terms(category, enabled, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_cache_expiry
                ON translation_cache(expires_at);
            """
        )
        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        connection.execute(
            """
            INSERT OR IGNORE INTO app_settings(
                id, default_output_directory, batch_size,
                log_level, updated_at
            ) VALUES(1, NULL, 50, 'info', ?)
            """,
            (now,),
        )
        existing_keys: set[str] = set()
        terms = connection.execute(
            """
            SELECT id, source_text, exact_match, case_sensitive
            FROM glossary_terms
            ORDER BY created_at, id
            """
        ).fetchall()
        for term in terms:
            canonical_key = build_glossary_term_key(
                str(term["source_text"]),
                bool(term["exact_match"]),
                bool(term["case_sensitive"]),
            )
            term_key = canonical_key
            if canonical_key in existing_keys:
                term_key = f"{canonical_key}:legacy:{term['id']}"
            existing_keys.add(term_key)
            connection.execute(
                "UPDATE glossary_terms SET term_key = ? WHERE id = ?",
                (term_key, term["id"]),
            )
        connection.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_glossary_term_key
            ON glossary_terms(term_key)
            WHERE term_key IS NOT NULL
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO app_meta(key, value)
            VALUES('last_cleanup_at', '')
            """
        )
        connection.execute(
            """
            INSERT OR IGNORE INTO app_meta(key, value)
            VALUES('last_cleanup_summary', '{}')
            """
        )
        connection.execute("PRAGMA user_version = 3")
        version = 3

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
