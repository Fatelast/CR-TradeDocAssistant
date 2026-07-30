"""Worker 协议单元测试。"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

WORKER_SRC = Path(__file__).resolve().parents[1] / "src"
SAMPLES = Path(__file__).resolve().parents[3] / "resources" / "samples"
sys.path.insert(0, str(WORKER_SRC))

from protocol import PROTOCOL_VERSION, handle_line  # noqa: E402


class ProtocolTestCase(unittest.TestCase):
    def request(
        self,
        action: str,
        payload: dict[str, object],
        request_id: str = "req_test",
    ) -> dict[str, object]:
        return handle_line(
            json.dumps(
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "id": request_id,
                    "type": "request",
                    "action": action,
                    "payload": payload,
                }
            )
        )

    def test_get_worker_info(self) -> None:
        response = self.request("get_worker_info", {})

        self.assertEqual(response["type"], "completed")
        self.assertEqual(response["id"], "req_test")
        self.assertEqual(
            response["data"]["protocolVersion"],
            PROTOCOL_VERSION,
        )
        self.assertTrue(response["data"]["workerVersion"])
        self.assertTrue(response["data"]["pythonVersion"])

    def test_invalid_json_returns_stable_error(self) -> None:
        response = handle_line("{invalid")

        self.assertEqual(response["type"], "error")
        self.assertEqual(response["error"]["code"], "INVALID_MESSAGE")

    def test_unknown_action_returns_stable_error(self) -> None:
        response = self.request("unknown", {}, "req_unknown")

        self.assertEqual(response["type"], "error")
        self.assertEqual(response["id"], "req_unknown")
        self.assertEqual(
            response["error"]["code"],
            "UNSUPPORTED_ACTION",
        )

    def test_protocol_version_is_required(self) -> None:
        response = handle_line(
            json.dumps(
                {
                    "protocolVersion": "2.0",
                    "id": "req_version",
                    "type": "request",
                    "action": "get_worker_info",
                    "payload": {},
                }
            )
        )

        self.assertEqual(response["type"], "error")
        self.assertEqual(
            response["error"]["code"],
            "PROTOCOL_VERSION_UNSUPPORTED",
        )

    def test_parse_standard_workbook(self) -> None:
        response = self.request(
            "parse_workbook",
            {"filePath": str(SAMPLES / "m1-standard.xlsx")},
        )

        self.assertEqual(response["type"], "completed")
        data = response["data"]
        self.assertEqual(data["defaultSheetName"], "问题反馈")
        self.assertFalse(data["restricted"])
        self.assertEqual(data["sheets"][0]["rowCount"], 7)
        self.assertEqual(data["sheets"][0]["columnCount"], 5)
        self.assertEqual(data["sheets"][0]["recommendedHeaderRow"], 2)

    def test_preview_and_build_import_rows(self) -> None:
        preview = self.request(
            "preview_sheet",
            {
                "filePath": str(SAMPLES / "m1-standard.xlsx"),
                "sheetName": "问题反馈",
                "headerRow": 2,
            },
        )

        self.assertEqual(preview["type"], "completed")
        preview_data = preview["data"]
        self.assertEqual(preview_data["recommendations"]["sourceColumn"], 3)
        self.assertEqual(preview_data["recommendations"]["targetColumn"], 4)
        self.assertEqual(preview_data["recommendations"]["containerColumn"], 1)

        rows = self.request(
            "build_import_rows",
            {
                "filePath": str(SAMPLES / "m1-standard.xlsx"),
                "sheetName": "问题反馈",
                "headerRow": 2,
                "sourceColumn": 3,
                "targetColumn": 4,
                "containerColumn": 1,
            },
        )

        self.assertEqual(rows["type"], "completed")
        rows_data = rows["data"]
        self.assertEqual(rows_data["totalRows"], 5)
        self.assertEqual(rows_data["rows"][0]["sourceCell"], "C3")
        self.assertEqual(rows_data["rows"][0]["targetCell"], "D3")
        self.assertEqual(rows_data["rows"][0]["containerCell"], "A3")

    def test_risky_workbook_is_restricted(self) -> None:
        response = self.request(
            "parse_workbook",
            {"filePath": str(SAMPLES / "m1-risky.xlsx")},
        )

        self.assertEqual(response["type"], "completed")
        data = response["data"]
        risk_codes = {risk["code"] for risk in data["risks"]}
        self.assertTrue(data["restricted"])
        self.assertIn("DATA_VALIDATION", risk_codes)
        self.assertIn("CONDITIONAL_FORMATTING", risk_codes)

    def test_over_limit_workbook_returns_stable_error(self) -> None:
        response = self.request(
            "parse_workbook",
            {"filePath": str(SAMPLES / "m1-over-limit.xlsx")},
        )

        self.assertEqual(response["type"], "error")
        self.assertEqual(response["error"]["code"], "ROW_LIMIT_EXCEEDED")


if __name__ == "__main__":
    unittest.main()
