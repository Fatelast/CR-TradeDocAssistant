"""Worker 标准输入/输出集成测试。"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

WORKER_ENTRY = Path(__file__).resolve().parents[1] / "src" / "main.py"


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


if __name__ == "__main__":
    unittest.main()
