"""M2 离线翻译保护规则与术语匹配。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

PROTECTION_VERSION = "1"

PROTECTED_PATTERN = re.compile(
    "|".join(
        (
            r"https?://[^\s]+",
            r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",
            r"\b[A-Z]{4}\d{7}\b",
            r"\b(?:PO|INV|BL|AWB|CMR|NO)[-_:/]?[A-Z0-9-]{3,}\b",
            r"\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b",
            r"\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b",
            r"(?:[$€¥₽]\s?\d+(?:[.,]\d+)?)",
            r"\b(?:USD|EUR|CNY|RMB|RUB)\b",
            r"\b[A-Z]{2,}[A-Z0-9._/-]*\d[A-Z0-9._/-]*\b",
            r"\b\d+(?:[.,]\d+)?\s?(?:kg|g|t|mm|cm|m|m²|m³|шт|кг)\b",
            r"\b\d+(?:[.,]\d+)?\b",
        )
    ),
    re.IGNORECASE,
)
TOKEN_PATTERN = re.compile(r"⟦P\d{4}⟧")


@dataclass(frozen=True)
class ProtectionError(Exception):
    """保护片段在翻译结果中缺失或被修改。"""

    message: str


def protect_text(source_text: str) -> tuple[str, dict[str, str]]:
    """用稳定占位符保护编号、日期、金额和联系方式等片段。"""

    protected_values: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        token = f"⟦P{len(protected_values) + 1:04d}⟧"
        protected_values[token] = match.group(0)
        return token

    return PROTECTED_PATTERN.sub(replace, source_text), protected_values


def restore_text(
    translated_text: str,
    protected_values: dict[str, str],
) -> str:
    """恢复占位符并校验数量与内容完整性。"""

    result = translated_text
    for token, original_value in protected_values.items():
        if result.count(token) != 1:
            raise ProtectionError(f"保护片段 {token} 无法完整恢复")
        result = result.replace(token, original_value)

    if TOKEN_PATTERN.search(result):
        raise ProtectionError("翻译结果包含未知保护占位符")
    return result


def _replace_literal(
    text: str,
    source: str,
    target: str,
    case_sensitive: bool,
) -> tuple[str, int]:
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.subn(re.escape(source), target, text, flags=flags)


def match_glossary(
    source_text: str,
    terms: list[dict[str, Any]],
) -> str | None:
    """先执行整句精确匹配，再执行受保护的字面术语替换。"""

    for term in terms:
        if not term["exactMatch"]:
            continue
        candidate = term["sourceText"]
        matched = (
            source_text == candidate
            if term["caseSensitive"]
            else source_text.casefold() == candidate.casefold()
        )
        if matched:
            return str(term["targetText"])

    protected_text, protected_values = protect_text(source_text)
    replaced_text = protected_text
    replacement_count = 0
    partial_terms = sorted(
        (term for term in terms if not term["exactMatch"]),
        key=lambda term: len(str(term["sourceText"])),
        reverse=True,
    )
    for term in partial_terms:
        replaced_text, count = _replace_literal(
            replaced_text,
            str(term["sourceText"]),
            str(term["targetText"]),
            bool(term["caseSensitive"]),
        )
        replacement_count += count

    if replacement_count == 0:
        return None
    return restore_text(replaced_text, protected_values)
