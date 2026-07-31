"""Worker 标准输入/输出集成测试。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

WORKER_ENTRY = Path(__file__).resolve().parents[1] / "src" / "main.py"
STANDARD_WORKBOOK = (
    Path(__file__).resolve().parents[3]
    / "resources"
    / "samples"
    / "m1-standard.xlsx"
)


class WorkerProcessTestCase(unittest.TestCase):
    def test_worker_process_returns_one_json_line(self) -> None:
        request = {
            "protocolVersion": "1.0",
            "id": "req_process",
            "type": "request",
            "action": "get_worker_info",
            "payload": {},
        }
        process = subprocess.run(
            [sys.executable, str(WORKER_ENTRY)],
            input=json.dumps(request) + "\n",
            capture_output=True,
            check=False,
            encoding="utf-8",
            timeout=5,
        )

        self.assertEqual(process.returncode, 0)
        stdout_lines = process.stdout.splitlines()
        self.assertEqual(len(stdout_lines), 1)

        response = json.loads(stdout_lines[0])
        self.assertEqual(response["type"], "completed")
        self.assertEqual(response["id"], "req_process")
        self.assertEqual(response["data"]["workerVersion"], "0.6.0-beta.1")

    def test_worker_process_forces_utf8_protocol(self) -> None:
        request = {
            "protocolVersion": "1.0",
            "id": "req_utf8",
            "type": "request",
            "action": "parse_workbook",
            "payload": {"filePath": str(STANDARD_WORKBOOK)},
        }
        environment = {
            **os.environ,
            "PYTHONIOENCODING": "cp936",
        }
        process = subprocess.run(
            [sys.executable, str(WORKER_ENTRY)],
            input=(json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8"),
            capture_output=True,
            check=False,
            env=environment,
            timeout=10,
        )

        self.assertEqual(process.returncode, 0)
        response = json.loads(process.stdout.decode("utf-8"))
        self.assertEqual(response["type"], "completed")
        self.assertEqual(response["data"]["defaultSheetName"], "问题反馈")


if __name__ == "__main__":
    unittest.main()
