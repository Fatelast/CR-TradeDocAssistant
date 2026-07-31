"""真实样本清单校验工具测试。"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VERIFY_SCRIPT = PROJECT_ROOT / "scripts" / "verify_regression_manifest.py"


class RegressionManifestScriptTestCase(unittest.TestCase):
    def create_fixture(self, directory: Path) -> tuple[Path, Path]:
        workbook_path = directory / "脱敏样本.xlsx"
        workbook = Workbook()
        worksheet = workbook.active
        worksheet.title = "主表"
        worksheet.append(["箱号", "俄文原文", "中文翻译"])
        worksheet.append(["MSCU1234567", "Повреждена внешняя упаковка", "外包装受损"])
        hidden = workbook.create_sheet("隐藏表")
        hidden.sheet_state = "hidden"
        hidden.append(["说明"])
        workbook.save(workbook_path)
        workbook.close()

        manifest_path = directory / "m5-regression-manifest.json"
        manifest_path.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "samples": [
                        {
                            "id": "fixture",
                            "file": workbook_path.name,
                            "category": "多工作表与隐藏工作表",
                            "sha256": hashlib.sha256(
                                workbook_path.read_bytes(),
                            ).hexdigest(),
                            "expected": {
                                "sheetCount": 2,
                                "sourceSheet": "主表",
                                "headerRow": 1,
                                "sourceColumn": 2,
                                "targetColumn": 3,
                                "mustPreserveFormulas": True,
                                "mustPreserveStyles": True,
                            },
                            "excelResult": "pass",
                            "wpsResult": "pending",
                            "knownLimitations": [],
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return workbook_path, manifest_path

    def run_validator(
        self,
        manifest_path: Path,
        *arguments: str,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                str(VERIFY_SCRIPT),
                "--manifest",
                str(manifest_path),
                *arguments,
            ],
            capture_output=True,
            check=False,
            encoding="utf-8",
            env={
                **os.environ,
                "PYTHONIOENCODING": "utf-8",
                "PYTHONUTF8": "1",
            },
            timeout=10,
        )

    def test_valid_manifest_and_strict_office_mode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            _workbook_path, manifest_path = self.create_fixture(
                Path(temporary_directory),
            )
            result = self.run_validator(manifest_path)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["passedCount"], 1)
            self.assertEqual(report["failedCount"], 0)
            self.assertIn("HIDDEN_SHEETS", report["samples"][0]["riskCodes"])

            strict_result = self.run_validator(
                manifest_path,
                "--strict-office-results",
            )
            self.assertEqual(strict_result.returncode, 1)
            strict_report = json.loads(strict_result.stdout)
            self.assertIn(
                "wpsResult 尚未完成 Office 验收",
                strict_report["failures"][0]["error"],
            )

            document = json.loads(manifest_path.read_text(encoding="utf-8"))
            document["samples"][0]["wpsResult"] = "fail"
            manifest_path.write_text(
                json.dumps(document, ensure_ascii=False),
                encoding="utf-8",
            )
            failed_result = self.run_validator(manifest_path)
            self.assertEqual(failed_result.returncode, 1)
            failed_report = json.loads(failed_result.stdout)
            self.assertIn(
                "wpsResult 已记录为验收失败",
                failed_report["failures"][0]["error"],
            )

    def test_hash_mismatch_does_not_change_sample(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            workbook_path, manifest_path = self.create_fixture(
                Path(temporary_directory),
            )
            before = workbook_path.read_bytes()
            document = json.loads(manifest_path.read_text(encoding="utf-8"))
            document["samples"][0]["sha256"] = "0" * 64
            manifest_path.write_text(
                json.dumps(document, ensure_ascii=False),
                encoding="utf-8",
            )

            result = self.run_validator(manifest_path)
            self.assertEqual(result.returncode, 1)
            report = json.loads(result.stdout)
            self.assertIn("SHA-256", report["failures"][0]["error"])
            self.assertEqual(workbook_path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()