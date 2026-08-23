#!/usr/bin/env python3
"""Extract KandiPad's archived fuse-bead color reference without web access."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
RGB_RE = re.compile(r"^(\d{1,3}),(\d{1,3}),(\d{1,3})$")
TRAILING_CODE_RE = re.compile(r"^(.+?)\s+\(([^()]*)\)$")
CODE_ONLY_RE = re.compile(r"^[A-Za-z]{1,3}\d{1,4}$")
BRAND_TERMS_RE = re.compile(r"Perler|Artkal|MARD|Hama|Top Tier|Nabbi", re.IGNORECASE)
HEX_LITERAL_RE = re.compile(r"#[0-9a-fA-F]{6}")
CSV_FIELDS = [
    "brand",
    "section_id",
    "section_heading",
    "section_ordinal",
    "color_ordinal_in_section",
    "color_ordinal",
    "source_name",
    "color_name",
    "catalog_code",
    "catalog_code_parse_rule",
    "hex_primary",
    "hex_primary_normalized",
    "hex_secondary",
    "hex_secondary_normalized",
    "rgb",
    "rgb_r",
    "rgb_g",
    "rgb_b",
    "display_name",
    "display_hex",
    "display_rgb",
    "swatch_style",
    "source_title",
    "source_brand",
    "api_palette_id",
    "api_palette_name",
    "api_color_id",
    "api_brand_id",
    "api_color_sort",
    "api_active",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def atomic_write_json(path: Path, value: Any) -> None:
    payload = json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
    atomic_write_bytes(path, payload)


def normalize_text(parts: Iterable[str]) -> str:
    return " ".join("".join(parts).split())


def parse_rgb(value: str) -> tuple[int, int, int] | None:
    match = RGB_RE.fullmatch(value)
    if not match:
        return None
    channels = tuple(int(match.group(index)) for index in range(1, 4))
    if any(channel > 255 for channel in channels):
        return None
    return channels  # type: ignore[return-value]


def rgb_from_hex(value: str) -> tuple[int, int, int] | None:
    if not HEX_RE.fullmatch(value):
        return None
    return tuple(int(value[index : index + 2], 16) for index in (1, 3, 5))  # type: ignore[return-value]


def split_source_name(source_name: str) -> dict[str, str | None]:
    trailing = TRAILING_CODE_RE.fullmatch(source_name)
    if trailing:
        return {
            "colorName": trailing.group(1),
            "catalogCode": trailing.group(2),
            "catalogCodeParseRule": "trailing-parenthetical",
        }
    if CODE_ONLY_RE.fullmatch(source_name):
        return {
            "colorName": None,
            "catalogCode": source_name,
            "catalogCodeParseRule": "code-like-source-label",
        }
    return {
        "colorName": source_name,
        "catalogCode": None,
        "catalogCodeParseRule": "name-only-source-label",
    }


class ColorReferenceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sections: list[dict[str, Any]] = []
        self.current_section: dict[str, Any] | None = None
        self.current_row: dict[str, Any] | None = None
        self.capture: str | None = None
        self.capture_parts: list[str] = []
        self.global_color_ordinal = 0

    @staticmethod
    def classes(attributes: dict[str, str]) -> set[str]:
        return set(attributes.get("class", "").split())

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        classes = self.classes(attributes)
        if tag == "section" and "brand-section" in classes:
            self.current_section = {
                "sectionOrdinal": len(self.sections) + 1,
                "sectionId": attributes.get("id", ""),
                "brand": attributes.get("data-brand", ""),
                "heading": "",
                "colors": [],
            }
            self.sections.append(self.current_section)
        elif tag == "h2" and self.current_section is not None:
            self.capture = "heading"
            self.capture_parts = []
        elif tag == "tr" and self.current_section is not None:
            self.current_row = {"source": {}, "visible": {}}
        elif tag == "div" and "ref-swatch" in classes and self.current_row is not None:
            self.current_row["source"] = {
                "dataBrand": attributes.get("data-brand", ""),
                "dataName": attributes.get("data-name", ""),
                "dataHex": attributes.get("data-hex", ""),
                "dataHexB": attributes.get("data-hex-b", ""),
                "dataRgb": attributes.get("data-rgb", ""),
                "style": attributes.get("style", ""),
                "title": attributes.get("title", ""),
                "rawSwatchTag": self.get_starttag_text() or "",
            }
        elif tag == "span" and self.current_row is not None:
            capture_for_class = {
                "ref-color-name": "displayName",
                "code-hex": "displayHex",
                "code-rgb": "displayRgb",
            }
            for class_name, capture_name in capture_for_class.items():
                if class_name in classes:
                    self.capture = capture_name
                    self.capture_parts = []
                    break

    def handle_data(self, data: str) -> None:
        if self.capture is not None:
            self.capture_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "h2" and self.capture == "heading" and self.current_section is not None:
            self.current_section["heading"] = normalize_text(self.capture_parts)
            self.capture = None
            self.capture_parts = []
        elif tag == "span" and self.capture in {"displayName", "displayHex", "displayRgb"}:
            if self.current_row is not None:
                self.current_row["visible"][self.capture] = normalize_text(self.capture_parts)
            self.capture = None
            self.capture_parts = []
        elif tag == "tr" and self.current_row is not None:
            source = self.current_row.get("source", {})
            if source.get("rawSwatchTag") and self.current_section is not None:
                self.global_color_ordinal += 1
                source_name = source.get("dataName", "")
                primary = source.get("dataHex", "")
                secondary = source.get("dataHexB", "")
                rgb = parse_rgb(source.get("dataRgb", ""))
                derived = split_source_name(source_name)
                derived.update(
                    {
                        "hexPrimaryNormalized": primary.upper() if HEX_RE.fullmatch(primary) else None,
                        "hexSecondaryNormalized": secondary.upper() if HEX_RE.fullmatch(secondary) else None,
                        "rgbChannels": list(rgb) if rgb else None,
                    }
                )
                self.current_row.update(
                    {
                        "globalOrdinal": self.global_color_ordinal,
                        "colorOrdinalInSection": len(self.current_section["colors"]) + 1,
                        "derived": derived,
                    }
                )
                self.current_section["colors"].append(self.current_row)
            self.current_row = None
        elif tag == "section" and self.current_section is not None:
            self.current_section = None


def make_duplicate_groups(
    rows: list[dict[str, Any]],
    key_builder: Any,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = key_builder(row)
        if not key:
            continue
        groups[str(key)].append(
            {
                "brand": row["brand"],
                "globalOrdinal": row["globalOrdinal"],
                "sourceName": row["source"]["dataName"],
                "catalogCode": row["derived"]["catalogCode"],
            }
        )
    return [
        {"key": key, "count": len(items), "rows": items}
        for key, items in sorted(groups.items())
        if len(items) > 1
    ]


def flatten_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for section in sections:
        for color in section["colors"]:
            color["brand"] = section["brand"]
            color["sectionId"] = section["sectionId"]
            color["sectionHeading"] = section["heading"]
            color["brandSectionOrdinal"] = section["sectionOrdinal"]
            rows.append(color)
    return rows


def validate_rows(sections: list[dict[str, Any]], rows: list[dict[str, Any]]) -> dict[str, Any]:
    invalid_primary: list[int] = []
    invalid_secondary: list[int] = []
    invalid_rgb: list[int] = []
    rgb_hex_mismatch: list[int] = []
    brand_mismatch: list[int] = []
    name_mismatch: list[int] = []
    display_hex_mismatch: list[int] = []
    display_rgb_mismatch: list[int] = []
    missing_rgb: list[int] = []
    secondary_hex_rows: list[int] = []
    parse_rules: Counter[str] = Counter()

    for row in rows:
        ordinal = row["globalOrdinal"]
        source = row["source"]
        visible = row["visible"]
        derived = row["derived"]
        parse_rules[derived["catalogCodeParseRule"]] += 1
        primary = source["dataHex"]
        secondary = source["dataHexB"]
        source_rgb = source["dataRgb"]
        if not HEX_RE.fullmatch(primary):
            invalid_primary.append(ordinal)
        if secondary:
            secondary_hex_rows.append(ordinal)
            if not HEX_RE.fullmatch(secondary):
                invalid_secondary.append(ordinal)
        if not source_rgb:
            missing_rgb.append(ordinal)
        else:
            parsed_rgb = parse_rgb(source_rgb)
            if parsed_rgb is None:
                invalid_rgb.append(ordinal)
            elif rgb_from_hex(primary) != parsed_rgb:
                rgb_hex_mismatch.append(ordinal)
        if source["dataBrand"] != row["brand"]:
            brand_mismatch.append(ordinal)
        if visible.get("displayName", "") != source["dataName"]:
            name_mismatch.append(ordinal)
        if visible.get("displayHex", "").upper() != primary.upper():
            display_hex_mismatch.append(ordinal)
        if visible.get("displayRgb", "") != source_rgb:
            display_rgb_mismatch.append(ordinal)

    exact_duplicates = make_duplicate_groups(
        rows,
        lambda row: "\u001f".join(
            [
                row["brand"],
                row["source"]["dataName"],
                row["source"]["dataHex"].upper(),
                row["source"]["dataHexB"].upper(),
                row["source"]["dataRgb"],
            ]
        ),
    )
    brand_name_duplicates = make_duplicate_groups(
        rows,
        lambda row: f"{row['brand']}\u001f{row['source']['dataName']}",
    )
    brand_code_duplicates = make_duplicate_groups(
        rows,
        lambda row: (
            f"{row['brand']}\u001f{row['derived']['catalogCode']}"
            if row["derived"]["catalogCode"]
            else ""
        ),
    )
    primary_hex_duplicates = make_duplicate_groups(
        rows,
        lambda row: row["source"]["dataHex"].upper(),
    )
    extraction_integrity_pass = not any(
        (
            invalid_primary,
            invalid_secondary,
            invalid_rgb,
            brand_mismatch,
            name_mismatch,
            display_hex_mismatch,
            display_rgb_mismatch,
        )
    )
    return {
        "extractionIntegrityPass": extraction_integrity_pass,
        "sectionCount": len(sections),
        "colorCount": len(rows),
        "brandCounts": {section["brand"]: len(section["colors"]) for section in sections},
        "catalogCodeParseRules": dict(sorted(parse_rules.items())),
        "secondaryHexCount": len(secondary_hex_rows),
        "missingRgbCount": len(missing_rgb),
        "invalidPrimaryHex": invalid_primary,
        "invalidSecondaryHex": invalid_secondary,
        "invalidRgb": invalid_rgb,
        "rgbHexMismatch": rgb_hex_mismatch,
        "brandMismatch": brand_mismatch,
        "nameMismatch": name_mismatch,
        "displayHexMismatch": display_hex_mismatch,
        "displayRgbMismatch": display_rgb_mismatch,
        "duplicates": {
            "exactRowGroups": exact_duplicates,
            "brandAndSourceNameGroups": brand_name_duplicates,
            "brandAndCatalogCodeGroups": brand_code_duplicates,
            "primaryHexAcrossRowsGroups": primary_hex_duplicates,
        },
        "duplicateGroupCounts": {
            "exactRowGroups": len(exact_duplicates),
            "brandAndSourceNameGroups": len(brand_name_duplicates),
            "brandAndCatalogCodeGroups": len(brand_code_duplicates),
            "primaryHexAcrossRowsGroups": len(primary_hex_duplicates),
        },
    }


def inspect_javascript(paths: list[Path]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        result.append(
            {
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
                "brandTermMentions": len(BRAND_TERMS_RE.findall(text)),
                "uniqueSixDigitHexLiterals": len({value.upper() for value in HEX_LITERAL_RE.findall(text)}),
                "containsKnownPaletteValueF5A168": "#f5a168" in text.lower(),
                "containsDataBrand": "data-brand" in text,
                "containsColorTitle": "color_title" in text,
                "containsStripeSecondaryColors": "stripeSecondaryColors" in text,
                "paletteRowsExtracted": 0,
            }
        )
    return result


def palette_record_key(brand: str, color: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        brand,
        str(color.get("color_name", "")),
        str(color.get("color_hex", "")),
        str(color.get("color_hex_b", "")),
        str(color.get("color_rgb", "")),
    )


def html_row_key(row: dict[str, Any]) -> tuple[str, str, str, str, str]:
    source = row["source"]
    return (
        row["brand"],
        source["dataName"],
        source["dataHex"],
        source["dataHexB"],
        source["dataRgb"],
    )


def key_as_dict(key: tuple[str, str, str, str, str], count: int) -> dict[str, Any]:
    return {
        "brand": key[0],
        "colorName": key[1],
        "colorHex": key[2],
        "colorHexB": key[3],
        "colorRgb": key[4],
        "count": count,
    }


def load_palette_api_archives(
    api_dir: Path,
    rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    response_paths = sorted(
        path
        for path in api_dir.glob("get-palettes-*.json")
        if not path.name.endswith(".http.json")
    )
    evidence: list[dict[str, Any]] = []
    responses: dict[str, dict[str, Any]] = {}
    for path in response_paths:
        shape = path.name.removeprefix("get-palettes-").removesuffix(".json")
        metadata_path = path.with_name(path.stem + ".http.json")
        body_hash = sha256_file(path)
        parsed = json.loads(path.read_text(encoding="utf-8"))
        metadata = (
            json.loads(metadata_path.read_text(encoding="utf-8"))
            if metadata_path.is_file()
            else {}
        )
        metadata_hash = metadata.get("response", {}).get("sha256")
        kp_palettes = parsed.get("kp", []) if isinstance(parsed, dict) else []
        user_palettes = parsed.get("user", []) if isinstance(parsed, dict) else []
        kp_colors = sum(
            len(palette.get("palette", []))
            for palette in kp_palettes
            if isinstance(palette, dict)
        )
        user_colors = sum(
            len(palette.get("palette", []))
            for palette in user_palettes
            if isinstance(palette, dict)
        )
        evidence.append(
            {
                "shape": shape,
                "responsePath": str(path),
                "httpMetadataPath": str(metadata_path) if metadata_path.is_file() else None,
                "bytes": path.stat().st_size,
                "sha256": body_hash,
                "httpStatus": metadata.get("response", {}).get("status"),
                "httpMetadataSha256Matches": metadata_hash == body_hash,
                "topLevelKeys": list(parsed) if isinstance(parsed, dict) else [],
                "kpPaletteCount": len(kp_palettes),
                "kpColorCount": kp_colors,
                "userPaletteCount": len(user_palettes),
                "userColorCount": user_colors,
            }
        )
        if isinstance(parsed, dict):
            responses[shape] = parsed

    primary_shape = "square" if "square" in responses else next(iter(responses), None)
    if primary_shape is None:
        return evidence, {
            "available": False,
            "pass": False,
            "reason": "No successful archived palette API response found.",
        }

    primary = responses[primary_shape]
    kp_palettes = primary.get("kp", [])
    api_records: list[dict[str, Any]] = []
    api_by_brand: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    lookup: dict[tuple[str, str, str, str, str], list[dict[str, Any]]] = defaultdict(list)
    sku_field_count = 0
    palette_ids_by_brand: dict[str, str] = {}
    for palette in kp_palettes:
        if not isinstance(palette, dict):
            continue
        brand = str(palette.get("palette_name", ""))
        palette_id = str(palette.get("palette_id", ""))
        palette_ids_by_brand[brand] = palette_id
        for color in palette.get("palette", []):
            if not isinstance(color, dict):
                continue
            if "sku" in color:
                sku_field_count += 1
            key = palette_record_key(brand, color)
            record = {
                "paletteId": palette_id,
                "paletteName": brand,
                "colorId": str(color.get("id", "")),
                "brandId": str(color.get("brand_id", "")),
                "colorName": str(color.get("color_name", "")),
                "colorRgb": str(color.get("color_rgb", "")),
                "colorHex": str(color.get("color_hex", "")),
                "colorHexB": str(color.get("color_hex_b", "")),
                "colorSort": str(color.get("color_sort", "")),
                "active": str(color.get("active", "")),
            }
            api_records.append(record)
            api_by_brand[brand].append(key)
            lookup[key].append(record)

    html_counter = Counter(html_row_key(row) for row in rows)
    api_counter = Counter(
        (
            record["paletteName"],
            record["colorName"],
            record["colorHex"],
            record["colorHexB"],
            record["colorRgb"],
        )
        for record in api_records
    )
    remaining_lookup = {key: list(values) for key, values in lookup.items()}
    matched_rows = 0
    for row in rows:
        key = html_row_key(row)
        candidates = remaining_lookup.get(key, [])
        if candidates:
            row["api"] = candidates.pop(0)
            matched_rows += 1
        else:
            row["api"] = None

    missing_counter = html_counter - api_counter
    extra_counter = api_counter - html_counter
    html_by_brand: dict[str, list[tuple[str, str, str, str, str]]] = defaultdict(list)
    for row in rows:
        html_by_brand[row["brand"]].append(html_row_key(row))
    per_brand: dict[str, Any] = {}
    for brand in sorted(set(html_by_brand) | set(api_by_brand)):
        html_brand_counter = Counter(html_by_brand.get(brand, []))
        api_brand_counter = Counter(api_by_brand.get(brand, []))
        per_brand[brand] = {
            "paletteId": palette_ids_by_brand.get(brand),
            "htmlCount": sum(html_brand_counter.values()),
            "apiCount": sum(api_brand_counter.values()),
            "missingInApi": sum((html_brand_counter - api_brand_counter).values()),
            "extraInApi": sum((api_brand_counter - html_brand_counter).values()),
            "orderMatches": html_by_brand.get(brand, []) == api_by_brand.get(brand, []),
        }

    user_palettes = primary.get("user", []) if isinstance(primary, dict) else []
    user_palette_summary = [
        {
            "paletteId": str(palette.get("palette_id", "")),
            "paletteName": str(palette.get("palette_name", "")),
            "colorCount": len(palette.get("palette", [])),
        }
        for palette in user_palettes
        if isinstance(palette, dict)
    ]
    response_hashes = {item["sha256"] for item in evidence}
    metadata_hashes_match = all(item["httpMetadataSha256Matches"] for item in evidence)
    cross_pass = (
        len(missing_counter) == 0
        and len(extra_counter) == 0
        and matched_rows == len(rows)
        and metadata_hashes_match
    )
    cross_validation = {
        "available": True,
        "pass": cross_pass,
        "primaryShape": primary_shape,
        "shapeCount": len(evidence),
        "shapes": [item["shape"] for item in evidence],
        "allShapeResponseHashesIdentical": len(response_hashes) == 1,
        "responseHashes": sorted(response_hashes),
        "httpMetadataHashesMatchBodies": metadata_hashes_match,
        "kpPaletteCount": len(kp_palettes),
        "kpColorCount": len(api_records),
        "htmlColorCount": len(rows),
        "htmlRowsMatchedExactly": matched_rows,
        "missingInApi": [key_as_dict(key, count) for key, count in missing_counter.items()],
        "extraInApi": [key_as_dict(key, count) for key, count in extra_counter.items()],
        "standaloneSkuFieldCount": sku_field_count,
        "perBrand": per_brand,
        "userAggregatePalettes": user_palette_summary,
        "userAggregatePalettesMergedIntoBrandExport": False,
    }
    return evidence, cross_validation


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    source = row["source"]
    visible = row["visible"]
    derived = row["derived"]
    api = row.get("api") or {}
    channels = derived["rgbChannels"] or ["", "", ""]
    return {
        "brand": row["brand"],
        "section_id": row["sectionId"],
        "section_heading": row["sectionHeading"],
        "section_ordinal": row["brandSectionOrdinal"],
        "color_ordinal_in_section": row["colorOrdinalInSection"],
        "color_ordinal": row["globalOrdinal"],
        "source_name": source["dataName"],
        "color_name": derived["colorName"] or "",
        "catalog_code": derived["catalogCode"] or "",
        "catalog_code_parse_rule": derived["catalogCodeParseRule"],
        "hex_primary": source["dataHex"],
        "hex_primary_normalized": derived["hexPrimaryNormalized"] or "",
        "hex_secondary": source["dataHexB"],
        "hex_secondary_normalized": derived["hexSecondaryNormalized"] or "",
        "rgb": source["dataRgb"],
        "rgb_r": channels[0],
        "rgb_g": channels[1],
        "rgb_b": channels[2],
        "display_name": visible.get("displayName", ""),
        "display_hex": visible.get("displayHex", ""),
        "display_rgb": visible.get("displayRgb", ""),
        "swatch_style": source["style"],
        "source_title": source["title"],
        "source_brand": source["dataBrand"],
        "api_palette_id": api.get("paletteId", ""),
        "api_palette_name": api.get("paletteName", ""),
        "api_color_id": api.get("colorId", ""),
        "api_brand_id": api.get("brandId", ""),
        "api_color_sort": api.get("colorSort", ""),
        "api_active": api.get("active", ""),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(csv_row(row))
    os.replace(temporary, path)


def readme_text(
    html_path: Path,
    html_sha256: str,
    js_evidence: list[dict[str, Any]],
    api_evidence: list[dict[str, Any]],
    api_cross_validation: dict[str, Any],
    validation: dict[str, Any],
) -> str:
    lines = [
        "# KandiPad 拼豆色板归档",
        "",
        "## 来源",
        "",
        f"- 原始页面：`{html_path.as_posix()}`",
        f"- 页面 SHA-256：`{html_sha256}`",
        "- 提取权威字段：页面每个 `.ref-swatch` 的 `data-brand`、`data-name`、`data-hex`、`data-hex-b`、`data-rgb`、`style` 和可见名称/HEX/RGB。",
        "- 公开接口：`POST https://kandipad.com/project/get-palettes`；请求参数和未经重排的原始响应保存在 `api/`，HTTP 元数据中的 Cookie 已脱敏。",
        "- 已检查同目录保存的 3 个 JS。它们包含渲染逻辑和双色条纹处理，但没有发现独立的品牌色表；因此没有从 JS 臆造或覆盖任何颜色记录。",
        "",
        "## 文件",
        "",
        "- `kandipad-color-reference.json`：按页面 section 原顺序保存的原始属性、可见文本和有限派生字段。`rawSwatchTag` 保留原始 swatch 起始标签。",
        "- `kandipad-color-reference.csv`：适合导入的扁平表，UTF-8 BOM。",
        "- `validation.json`：计数、重复组和 HEX/RGB/显示值一致性检查。",
        "- `api/get-palettes-<shape>.json`：接口的原始响应字节；相邻 `.http.json` 保存状态、响应头、请求参数、字节数和 SHA-256。",
        "",
        "## 品牌及颜色数量",
        "",
        "| 品牌 | 颜色数 |",
        "|---|---:|",
    ]
    for brand, count in validation["brandCounts"].items():
        lines.append(f"| {brand} | {count} |")
    rules = validation["catalogCodeParseRules"]
    duplicates = validation["duplicateGroupCounts"]
    api_order_matches = sum(
        1
        for item in api_cross_validation.get("perBrand", {}).values()
        if item.get("orderMatches")
    )
    lines.extend(
        [
            f"| **总计（{validation['sectionCount']} 个 section）** | **{validation['colorCount']}** |",
            "",
            "## 字段与未确定项",
            "",
            "- `source.dataName` 始终原样保留。",
            f"- `{rules.get('trailing-parenthetical', 0)}` 条仅按末尾括号拆出色号，例如 `Apricot (S96)`。",
            f"- `{rules.get('code-like-source-label', 0)}` 条原标签本身形如色号；CSV 将其放入 `catalog_code`，但 `color_name` 留空。",
            f"- `{rules.get('name-only-source-label', 0)}` 条没有可确定的独立色号，保持名称且 `catalog_code` 留空。",
            f"- `{validation['missingRgbCount']}` 条页面没有提供 RGB；未根据 HEX 回填源 RGB 字段。",
            f"- `{validation['secondaryHexCount']}` 条带 `data-hex-b` 第二 HEX；精确保留，不进一步猜测跨品牌对应关系。",
            f"- API 的 `kp` 数据没有独立 `sku` 字段（命中 {api_cross_validation.get('standaloneSkuFieldCount', 0)} 条）；CSV 的 `catalog_code` 仍只按上面的明确语法规则从 `color_name/data-name` 拆分。",
            "- API 顶层 `user` 是 KP Master 聚合色板，已原样保留在 API 响应中，但没有混入 16 个品牌导出。",
            "- 相同 HEX 出现在不同品牌或产品线时只作为重复统计，不表示官方等价色映射。",
            "",
            "## 验证",
            "",
            f"- 提取完整性：`{str(validation['extractionIntegrityPass']).lower()}`",
            f"- HTML section 标签 / 已解析：{validation['sourceBrandSectionTagCount']} / {validation['sectionCount']}",
            f"- HTML swatch 标签 / 已解析：{validation['sourceSwatchTagCount']} / {validation['colorCount']}",
            f"- 无效主 HEX：{len(validation['invalidPrimaryHex'])}",
            f"- 无效第二 HEX：{len(validation['invalidSecondaryHex'])}",
            f"- 无效非空 RGB：{len(validation['invalidRgb'])}",
            f"- RGB 与主 HEX 不一致：{len(validation['rgbHexMismatch'])}",
            f"- section/data-brand 不一致：{len(validation['brandMismatch'])}",
            f"- 可见名称与 data-name 不一致：{len(validation['nameMismatch'])}",
            f"- 可见 HEX 与 data-hex 不一致：{len(validation['displayHexMismatch'])}",
            f"- 完全相同记录重复组：{duplicates['exactRowGroups']}",
            f"- 同品牌同源名称重复组：{duplicates['brandAndSourceNameGroups']}",
            f"- 同品牌同解析色号重复组：{duplicates['brandAndCatalogCodeGroups']}",
            f"- 跨记录相同主 HEX 重复组：{duplicates['primaryHexAcrossRowsGroups']}",
            f"- API/HTML 精确集合交叉验证：`{str(api_cross_validation.get('pass', False)).lower()}`",
            f"- API 精确匹配 HTML 记录：{api_cross_validation.get('htmlRowsMatchedExactly', 0)} / {validation['colorCount']}",
            f"- API 缺少 / 额外记录：{len(api_cross_validation.get('missingInApi', []))} / {len(api_cross_validation.get('extraInApi', []))}",
            f"- API 与 HTML 顺序相同的品牌：{api_order_matches} / {validation['sectionCount']}；交叉验证按品牌、名称、主 HEX、第二 HEX、RGB 的完整五元组匹配，不擅自重解释顺序。",
            "",
            "## 已归档 API shape",
            "",
            "| shape | HTTP | 字节 | SHA-256 | KP 品牌 | KP 颜色 |",
            "|---|---:|---:|---|---:|---:|",
        ]
    )
    for item in api_evidence:
        lines.append(
            f"| {item['shape']} | {item['httpStatus']} | {item['bytes']} | "
            f"`{item['sha256']}` | {item['kpPaletteCount']} | {item['kpColorCount']} |"
        )
    lines.extend(
        [
            "",
            f"五种由创建页和已保存渲染 JS 明确使用的 fuse-board shape，其响应字节完全一致：`{str(api_cross_validation.get('allShapeResponseHashesIdentical', False)).lower()}`。",
            "",
            "## 已检查 JS",
            "",
            "| 文件 | SHA-256 | 品牌词命中 | 独立六位 HEX | 色板记录提取 |",
            "|---|---|---:|---:|---:|",
        ]
    )
    for item in js_evidence:
        lines.append(
            f"| {Path(item['path']).name} | `{item['sha256']}` | "
            f"{item['brandTermMentions']} | {item['uniqueSixDigitHexLiterals']} | 0 |"
        )
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--html",
        type=Path,
        default=Path("data/external-materials/kandipad/raw/common/fuse-bead-color-reference.html"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/external-materials/kandipad/palettes"),
    )
    args = parser.parse_args()
    html_path = args.html.resolve()
    output = args.output.resolve()
    if not html_path.is_file():
        parser.error(f"archived HTML not found: {html_path}")

    js_paths = sorted(html_path.parent.glob("*.js"))
    html_text = html_path.read_text(encoding="utf-8", errors="strict")
    palette_parser = ColorReferenceParser()
    palette_parser.feed(html_text)
    palette_parser.close()
    sections = palette_parser.sections
    rows = flatten_sections(sections)
    validation = validate_rows(sections, rows)
    validation["sourceBrandSectionTagCount"] = len(
        re.findall(r'<section\s+class="brand-section"', html_text, re.IGNORECASE)
    )
    validation["sourceSwatchTagCount"] = len(
        re.findall(r'<div\s+class="ref-swatch"', html_text, re.IGNORECASE)
    )
    validation["sourceCountsMatch"] = (
        validation["sourceBrandSectionTagCount"] == validation["sectionCount"]
        and validation["sourceSwatchTagCount"] == validation["colorCount"]
    )
    validation["extractionIntegrityPass"] = (
        validation["extractionIntegrityPass"] and validation["sourceCountsMatch"]
    )
    api_evidence, api_cross_validation = load_palette_api_archives(output / "api", rows)
    validation["apiCrossValidation"] = api_cross_validation
    validation["extractionIntegrityPass"] = (
        validation["extractionIntegrityPass"] and api_cross_validation.get("pass", False)
    )
    js_evidence = inspect_javascript(js_paths)
    html_sha256 = sha256_file(html_path)
    archive = {
        "schemaVersion": 1,
        "extractedAt": utc_now(),
        "source": {
            "htmlPath": str(html_path),
            "htmlBytes": html_path.stat().st_size,
            "htmlSha256": html_sha256,
            "authoritativeSelector": ".brand-section .ref-swatch",
            "javascriptInspection": js_evidence,
            "paletteApiInspection": api_evidence,
        },
        "fieldSemantics": {
            "source": "Exact HTML data attributes and visible text; rawSwatchTag preserves the original start tag.",
            "derived": "Only syntactic name/code splitting, uppercase HEX normalization, and parsed RGB channels.",
            "api": "Exact IDs and state fields joined only when brand, name, primary HEX, secondary HEX, and RGB all match.",
            "noCrossBrandMappingInferred": True,
        },
        "summary": {
            "sectionCount": validation["sectionCount"],
            "colorCount": validation["colorCount"],
            "brandCounts": validation["brandCounts"],
            "apiCrossValidationPass": api_cross_validation.get("pass", False),
        },
        "sections": sections,
    }

    output.mkdir(parents=True, exist_ok=True)
    atomic_write_json(output / "kandipad-color-reference.json", archive)
    write_csv(output / "kandipad-color-reference.csv", rows)
    atomic_write_json(output / "validation.json", validation)
    atomic_write_bytes(
        output / "README.md",
        readme_text(
            html_path,
            html_sha256,
            js_evidence,
            api_evidence,
            api_cross_validation,
            validation,
        ).encode("utf-8"),
    )
    print(
        json.dumps(
            {
                "sections": len(sections),
                "colors": len(rows),
                "output": str(output),
                "validationPass": validation["extractionIntegrityPass"],
                "apiCrossValidationPass": api_cross_validation.get("pass", False),
                "duplicateGroupCounts": validation["duplicateGroupCounts"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    return 0 if validation["extractionIntegrityPass"] and rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
