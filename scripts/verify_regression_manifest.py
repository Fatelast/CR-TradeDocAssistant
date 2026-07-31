"""校验本地脱敏 Excel 回归清单，不上传或修改任何业务文件。"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKER_SOURCE = PROJECT_ROOT / "workers" / "excel-worker" / "src"
sys.path.insert(0, str(WORKER_SOURCE))

from workbook import WorkbookError, build_import_rows, parse_workbook, preview_sheet

MANIFEST_SCHEMA_VERSION = 1
OFFICE_RESULTS = {"pending", "pass", "fail", "not_applicable"}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


class ManifestValidationError(Exception):
    """表示可归因于样本清单的校验错误。"""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ManifestValidationError(f"{field} 必须是非空字符串")
    return value.strip()


def _positive_integer(value: Any, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ManifestValidationError(f"{field} 必须是正整数")
    return value


def _sample_path(manifest_directory: Path, value: Any) -> Path:
    relative_path = Path(_string(value, "file"))
    if relative_path.is_absolute() or ".." in relative_path.parts:
        raise ManifestValidationError("file 必须是清单目录下的相对路径")
    path = (manifest_directory / relative_path).resolve()
    if manifest_directory not in path.parents:
        raise ManifestValidationError("file 超出清单目录")
    if path.suffix.lower() != ".xlsx" or not path.is_file():
        raise ManifestValidationError("file 必须指向存在的 .xlsx 文件")
    return path


def _office_result(value: Any, field: str, strict: bool) -> str:
    result = _string(value, field)
    if result not in OFFICE_RESULTS:
        raise ManifestValidationError(
            f"{field} 只能为 {', '.join(sorted(OFFICE_RESULTS))}",
        )
    if result == "fail":
        raise ManifestValidationError(f"{field} 已记录为验收失败")
    if strict and result not in {"pass", "not_applicable"}:
        raise ManifestValidationError(f"{field} 尚未完成 Office 验收")
    return result


def _validate_structure(
    expected: Any,
    workbook_data: dict[str, Any],
    sample_path: Path,
) -> dict[str, Any]:
    if not isinstance(expected, dict):
        raise ManifestValidationError("expected 必须是对象")

    sheet_count = _positive_integer(expected.get("sheetCount"), "expected.sheetCount")
    source_sheet = _string(expected.get("sourceSheet"), "expected.sourceSheet")
    header_row = _positive_integer(expected.get("headerRow"), "expected.headerRow")
    source_column = _positive_integer(expected.get("sourceColumn"), "expected.sourceColumn")
    raw_target_column = expected.get("targetColumn")
    target_column = (
        None
        if raw_target_column is None
        else _positive_integer(raw_target_column, "expected.targetColumn")
    )
    if target_column == source_column:
        raise ManifestValidationError("expected.targetColumn 不能与原文列相同")
    for field in ("mustPreserveFormulas", "mustPreserveStyles"):
        if not isinstance(expected.get(field), bool):
            raise ManifestValidationError(f"expected.{field} 必须是布尔值")

    sheets = workbook_data.get("sheets")
    actual_sheet_count = len(sheets) if isinstance(sheets, list) else 0
    if actual_sheet_count != sheet_count:
        raise ManifestValidationError(
            f"工作表数量不匹配：期望 {sheet_count}，实际 {actual_sheet_count}",
        )
    source_data = next(
        (sheet for sheet in sheets if sheet.get("name") == source_sheet),
        None,
    )
    if source_data is None:
        raise ManifestValidationError("expected.sourceSheet 在工作簿中不存在")
    if header_row > source_data.get("rowCount", 0):
        raise ManifestValidationError("expected.headerRow 超出有效行范围")
    if source_column > source_data.get("columnCount", 0):
        raise ManifestValidationError("expected.sourceColumn 超出有效列范围")
    if target_column is not None and target_column > source_data.get("columnCount", 0):
        raise ManifestValidationError("expected.targetColumn 超出有效列范围")

    preview_sheet(str(sample_path), source_sheet, header_row)
    imported = build_import_rows(
        str(sample_path),
        source_sheet,
        header_row,
        source_column,
        None,
        target_column,
    )
    return {
        "sourceSheet": source_sheet,
        "headerRow": header_row,
        "sourceColumn": source_column,
        "targetColumn": target_column,
        "importRowCount": imported["totalRows"],
    }


def validate_manifest(
    manifest_path: Path,
    strict_office_results: bool = False,
) -> dict[str, Any]:
    """读取并校验清单与其中列出的所有脱敏工作簿。"""

    try:
        document = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ManifestValidationError("清单文件不存在") from error
    except json.JSONDecodeError as error:
        raise ManifestValidationError("清单不是有效 JSON") from error

    if not isinstance(document, dict):
        raise ManifestValidationError("清单根节点必须是对象")
    if document.get("schemaVersion") != MANIFEST_SCHEMA_VERSION:
        raise ManifestValidationError(
            f"仅支持 schemaVersion {MANIFEST_SCHEMA_VERSION}",
        )
    samples = document.get("samples")
    if not isinstance(samples, list) or not samples:
        raise ManifestValidationError("samples 必须是非空数组")

    passed: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    sample_ids: set[str] = set()
    for sample in samples:
        sample_id = "unknown"
        try:
            if not isinstance(sample, dict):
                raise ManifestValidationError("样本项必须是对象")
            sample_id = _string(sample.get("id"), "id")
            if sample_id in sample_ids:
                raise ManifestValidationError("id 不能重复")
            sample_ids.add(sample_id)

            sample_path = _sample_path(manifest_path.parent, sample.get("file"))
            expected_hash = _string(sample.get("sha256"), "sha256").lower()
            valid_hash = len(expected_hash) == 64 and all(
                char in "0123456789abcdef" for char in expected_hash
            )
            if not valid_hash:
                raise ManifestValidationError("sha256 必须是 64 位十六进制值")
            actual_hash = _sha256(sample_path)
            if actual_hash != expected_hash:
                raise ManifestValidationError("样本 SHA-256 与清单不一致")

            _string(sample.get("category"), "category")
            workbook_data = parse_workbook(str(sample_path))
            structure = _validate_structure(
                sample.get("expected"),
                workbook_data,
                sample_path,
            )
            excel_result = _office_result(
                sample.get("excelResult"),
                "excelResult",
                strict_office_results,
            )
            wps_result = _office_result(
                sample.get("wpsResult"),
                "wpsResult",
                strict_office_results,
            )
            limitations = sample.get("knownLimitations")
            if not isinstance(limitations, list) or not all(
                isinstance(item, str) for item in limitations
            ):
                raise ManifestValidationError("knownLimitations 必须是字符串数组")

            passed.append(
                {
                    "id": sample_id,
                    "file": sample_path.name,
                    "sha256": actual_hash,
                    "sheetCount": len(workbook_data["sheets"]),
                    "restricted": workbook_data["restricted"],
                    "riskCodes": [risk["code"] for risk in workbook_data["risks"]],
                    "structure": structure,
                    "excelResult": excel_result,
                    "wpsResult": wps_result,
                },
            )
        except (ManifestValidationError, WorkbookError, OSError) as error:
            failures.append({"id": sample_id, "error": str(error)})

    return {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "sampleCount": len(samples),
        "passedCount": len(passed),
        "failedCount": len(failures),
        "samples": passed,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="本地脱敏样本清单 JSON 路径",
    )
    parser.add_argument(
        "--strict-office-results",
        action="store_true",
        help="要求 Excel 与 WPS 结果均为 pass 或 not_applicable",
    )
    arguments = parser.parse_args()
    try:
        report = validate_manifest(
            arguments.manifest.resolve(),
            arguments.strict_office_results,
        )
    except ManifestValidationError as error:
        report = {
            "failedCount": 1,
            "failures": [{"id": "manifest", "error": str(error)}],
        }

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report.get("failedCount") == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())