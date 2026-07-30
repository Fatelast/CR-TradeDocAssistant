"""M2 离线翻译任务与恢复测试。"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

WORKER_SRC = Path(__file__).resolve().parents[1] / "src"
SAMPLES = Path(__file__).resolve().parents[3] / "resources" / "samples"
sys.path.insert(0, str(WORKER_SRC))

from database import connect_database  # noqa: E402
from protocol import PROTOCOL_VERSION, handle_line  # noqa: E402
from translation import (  # noqa: E402
    ProtectionError,
    protect_text,
    restore_text,
)


class TranslationTaskTestCase(unittest.TestCase):
    def setUp(self) -> None:
        test_data_root = (
            Path(__file__).resolve().parents[1] / ".test-data"
        )
        test_data_root.mkdir(parents=True, exist_ok=True)
        self.temporary_directory = tempfile.TemporaryDirectory(
            dir=test_data_root,
        )
        self.previous_data_directory = os.environ.get("RUS_TRADE_DATA_DIR")
        os.environ["RUS_TRADE_DATA_DIR"] = self.temporary_directory.name

    def tearDown(self) -> None:
        if self.previous_data_directory is None:
            os.environ.pop("RUS_TRADE_DATA_DIR", None)
        else:
            os.environ["RUS_TRADE_DATA_DIR"] = self.previous_data_directory
        self.temporary_directory.cleanup()

    def request(
        self,
        action: str,
        payload: dict[str, object],
    ) -> dict[str, object]:
        return handle_line(
            json.dumps(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "id": f"req_{action}",
                    "type": "request",
                    "action": action,
                    "payload": payload,
                }
            )
        )

    def create_standard_task(self) -> dict[str, object]:
        response = self.request(
            "create_translation_task",
            {
                "filePath": str(SAMPLES / "m1-standard.xlsx"),
                "sheetName": "问题反馈",
                "headerRow": 2,
                "sourceColumn": 3,
                "containerColumn": 1,
                "targetColumn": 4,
            },
        )
        self.assertEqual(response["type"], "completed")
        return response["data"]

    def test_database_migration_and_builtin_glossary(self) -> None:
        with connect_database() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            term_count = connection.execute(
                "SELECT COUNT(*) FROM glossary_terms"
            ).fetchone()[0]

        self.assertEqual(version, 1)
        self.assertEqual(term_count, 5)

    def test_task_batch_manual_update_cache_and_recovery(self) -> None:
        detail = self.create_standard_task()
        task = detail["task"]

        self.assertEqual(task["status"], "draft")
        self.assertEqual(task["totalRows"], 5)
        self.assertEqual(task["pendingRows"], 4)
        self.assertEqual(task["completedRows"], 1)

        processed = self.request(
            "process_translation_batch",
            {"taskId": task["taskId"], "batchSize": 50},
        )
        self.assertEqual(processed["type"], "completed")
        processed_detail = processed["data"]
        self.assertEqual(processed_detail["task"]["status"], "awaiting_manual")
        self.assertEqual(processed_detail["task"]["candidateRows"], 4)
        self.assertEqual(processed_detail["task"]["completedRows"], 1)

        open_rows = [
            row
            for row in processed_detail["rows"]
            if row["status"] != "completed"
        ]
        first_row = open_rows[0]
        for index, row in enumerate(open_rows):
            updated = self.request(
                "update_translation_row",
                {
                    "taskId": task["taskId"],
                    "rowId": row["rowId"],
                    "translation": f"人工确认译文 {index + 1}",
                    "saveToCache": index == 0,
                },
            )
            self.assertEqual(updated["type"], "completed")

        final_detail = updated["data"]
        self.assertEqual(final_detail["task"]["status"], "completed")
        self.assertEqual(final_detail["task"]["completedRows"], 5)

        second_detail = self.create_standard_task()
        second_task_id = second_detail["task"]["taskId"]
        second_processed = self.request(
            "process_translation_batch",
            {"taskId": second_task_id},
        )
        cached_row = next(
            row
            for row in second_processed["data"]["rows"]
            if row["sourceText"] == first_row["sourceText"]
        )
        self.assertEqual(cached_row["candidateSource"], "cache")

        incomplete = self.request(
            "list_translation_tasks",
            {"includeCompleted": False},
        )
        self.assertEqual(incomplete["type"], "completed")
        self.assertEqual(len(incomplete["data"]["tasks"]), 1)
        self.assertEqual(
            incomplete["data"]["tasks"][0]["taskId"],
            second_task_id,
        )

    def test_exact_glossary_and_task_state_changes(self) -> None:
        term = self.request(
            "upsert_glossary_term",
            {
                "sourceText": "Повреждена внешняя упаковка",
                "targetText": "外包装受损",
                "exactMatch": True,
            },
        )
        self.assertEqual(term["type"], "completed")

        detail = self.create_standard_task()
        task_id = detail["task"]["taskId"]
        paused = self.request(
            "change_translation_task_state",
            {"taskId": task_id, "action": "pause"},
        )
        self.assertEqual(paused["data"]["task"]["status"], "paused")

        resumed = self.request(
            "change_translation_task_state",
            {"taskId": task_id, "action": "resume"},
        )
        self.assertEqual(resumed["data"]["task"]["status"], "running")

        processed = self.request(
            "process_translation_batch",
            {"taskId": task_id},
        )
        exact_row = next(
            row
            for row in processed["data"]["rows"]
            if row["sourceText"] == "Повреждена внешняя упаковка"
        )
        self.assertEqual(exact_row["translation"], "外包装受损")
        self.assertEqual(exact_row["candidateSource"], "glossary")

        cancelled = self.request(
            "change_translation_task_state",
            {"taskId": task_id, "action": "cancel"},
        )
        self.assertEqual(cancelled["data"]["task"]["status"], "cancelled")

    def test_protected_fragments_round_trip_and_validation(self) -> None:
        source = (
            "Контейнер MSCU1234567, заказ PO-2026-001, "
            "дата 2026-07-30, сумма USD 1250.50"
        )
        protected, values = protect_text(source)

        self.assertNotIn("MSCU1234567", protected)
        self.assertEqual(restore_text(protected, values), source)

        with self.assertRaises(ProtectionError):
            restore_text(protected.replace("⟦P0001⟧", ""), values)


if __name__ == "__main__":
    unittest.main()
