#!/usr/bin/env python3
"""Stream-verify a KandiPad material archive without modifying its inputs.

The verifier reads ``manifest.jsonl`` one record at a time, validates the four
expected files for each pattern, and writes an auditable CSV plus JSON summary.
Only one JSON document and one file hash chunk are held in memory at a time.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import struct
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Iterator
from urllib.parse import unquote, urlparse


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
PARTIAL_MARKERS = (".partial-", ".partial", ".part")
ERROR_PID_RE = re.compile(r"-(\d+)\.txt$", re.IGNORECASE)
MATRIX_COORD_RE = re.compile(r"^(-?\d+)_(-?\d+)$")
CSV_FIELDS = [
    "line",
    "pid",
    "slug",
    "status",
    "issues",
    "pattern_dir",
    "metadata_path",
    "metadata_size",
    "metadata_sha256",
    "metadata_valid",
    "matrix_path",
    "matrix_size",
    "matrix_sha256",
    "matrix_valid",
    "matrix_cells",
    "matrix_width",
    "matrix_height",
    "matrix_bad_keys",
    "thumbnail_path",
    "thumbnail_size",
    "thumbnail_sha256",
    "thumbnail_valid",
    "thumbnail_width",
    "thumbnail_height",
    "full_png_path",
    "full_png_size",
    "full_png_sha256",
    "full_png_valid",
    "full_png_width",
    "full_png_height",
    "error_records",
    "partial_files",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def relative_text(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.replace(temporary, path)


def expected_png_name(url: Any, full: bool) -> str | None:
    if not isinstance(url, str) or not url.strip():
        return None
    name = PurePosixPath(unquote(urlparse(url).path)).name
    if not name:
        return None
    return f"full-{name}" if full else name


def find_partial_files(directory: Path, root: Path) -> list[str]:
    if not directory.is_dir():
        return []
    partials: list[str] = []
    for path in directory.rglob("*"):
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if any(marker in lowered for marker in PARTIAL_MARKERS):
            partials.append(relative_text(path, root))
    return sorted(partials)


def find_archive_partial_files(root: Path) -> list[str]:
    partials: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        lowered = path.name.lower()
        if any(marker in lowered for marker in PARTIAL_MARKERS):
            partials.append(relative_text(path, root))
    return sorted(partials)


def index_error_records(root: Path) -> tuple[dict[int, list[str]], list[str]]:
    by_pid: dict[int, list[str]] = defaultdict(list)
    unassigned: list[str] = []
    error_root = root / "errors"
    if not error_root.is_dir():
        return by_pid, unassigned
    for path in error_root.rglob("*"):
        if not path.is_file():
            continue
        relative = relative_text(path, root)
        match = ERROR_PID_RE.search(path.name)
        if match:
            by_pid[int(match.group(1))].append(relative)
        else:
            unassigned.append(relative)
    for paths in by_pid.values():
        paths.sort()
    return by_pid, sorted(unassigned)


def check_json_file(
    path: Path,
    root: Path,
    compute_sha256: bool,
) -> tuple[dict[str, Any], Any | None]:
    result: dict[str, Any] = {
        "path": relative_text(path, root),
        "exists": False,
        "size": 0,
        "sha256": "",
        "valid": False,
        "error": "",
    }
    if not path.is_file():
        result["error"] = "missing"
        return result, None
    result["exists"] = True
    try:
        result["size"] = path.stat().st_size
        if compute_sha256:
            result["sha256"] = sha256_file(path)
        with path.open("r", encoding="utf-8-sig") as stream:
            parsed = json.load(stream)
        result["valid"] = True
        return result, parsed
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result, None


def check_png_file(path: Path, root: Path, compute_sha256: bool) -> dict[str, Any]:
    result: dict[str, Any] = {
        "path": relative_text(path, root),
        "exists": False,
        "size": 0,
        "sha256": "",
        "valid": False,
        "width": 0,
        "height": 0,
        "error": "",
    }
    if not path.is_file():
        result["error"] = "missing"
        return result
    result["exists"] = True
    try:
        result["size"] = path.stat().st_size
        if compute_sha256:
            result["sha256"] = sha256_file(path)
        with path.open("rb") as stream:
            header = stream.read(24)
        if len(header) < 24:
            result["error"] = "truncated PNG header"
            return result
        if header[:8] != PNG_SIGNATURE:
            result["error"] = "invalid PNG signature"
            return result
        chunk_length = struct.unpack(">I", header[8:12])[0]
        if chunk_length != 13 or header[12:16] != b"IHDR":
            result["error"] = "missing PNG IHDR"
            return result
        width, height = struct.unpack(">II", header[16:24])
        result["width"] = width
        result["height"] = height
        if width <= 0 or height <= 0:
            result["error"] = "invalid PNG dimensions"
            return result
        result["valid"] = True
        return result
    except (OSError, struct.error) as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        return result


def matrix_shape(matrix: Any) -> tuple[int, int, int, int]:
    if not isinstance(matrix, dict):
        return 0, 0, 0, 0
    # KandiPad currently exposes two native matrix encodings:
    # 1. direct coordinate keys whose values contain brand/hex data;
    # 2. a compact {"mtx": {coordinate: legend_index}, "lgd": [...]} form.
    # Older direct records can also contain the source's literal "undefined"
    # key. Preserve it in the raw JSON, but do not count it as a coordinate.
    wrapped = isinstance(matrix.get("mtx"), dict) and isinstance(matrix.get("lgd"), list)
    coordinates = matrix["mtx"] if wrapped else matrix
    bad_keys = (
        sum(1 for key in matrix if key not in {"mtx", "lgd"}) if wrapped else 0
    )
    xs: list[int] = []
    ys: list[int] = []
    cells = 0
    for key in coordinates:
        if not wrapped and key == "undefined":
            continue
        match = MATRIX_COORD_RE.fullmatch(str(key))
        if not match:
            bad_keys += 1
            continue
        cells += 1
        xs.append(int(match.group(1)))
        ys.append(int(match.group(2)))
    width = max(xs) - min(xs) + 1 if xs else 0
    height = max(ys) - min(ys) + 1 if ys else 0
    return cells, width, height, bad_keys


def iter_manifest(path: Path) -> Iterator[tuple[int, str]]:
    with path.open("r", encoding="utf-8-sig") as stream:
        for line_number, line in enumerate(stream, start=1):
            yield line_number, line


def add_file_counts(counter: Counter[str], prefix: str, check: dict[str, Any]) -> None:
    counter[f"{prefix}Expected"] += 1
    if check["exists"]:
        counter[f"{prefix}Present"] += 1
        counter[f"{prefix}Bytes"] += int(check["size"])
    else:
        counter[f"{prefix}Missing"] += 1
    if check["valid"]:
        counter[f"{prefix}Valid"] += 1
    elif check["exists"]:
        counter[f"{prefix}Invalid"] += 1


def issue_for_check(prefix: str, check: dict[str, Any]) -> str | None:
    if not check["exists"]:
        return f"{prefix}_missing"
    if not check["valid"]:
        return f"{prefix}_invalid"
    return None


def validate_output_path(path: Path, root: Path) -> None:
    material_root = (root / "patterns").resolve()
    resolved = path.resolve()
    if resolved == material_root or material_root in resolved.parents:
        raise ValueError(f"Refusing to write verification output under material files: {resolved}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("data/external-materials/kandipad"),
        help="Archive root containing manifest.jsonl and patterns/",
    )
    parser.add_argument("--manifest", type=Path, help="Defaults to ROOT/manifest.jsonl")
    parser.add_argument("--summary", type=Path, help="Defaults to ROOT/qa/verification-summary.json")
    parser.add_argument("--csv", type=Path, help="Defaults to ROOT/qa/verification-manifest.csv")
    parser.add_argument("--skip-sha256", action="store_true", help="Skip file hashing for a faster structural check")
    parser.add_argument("--progress-every", type=int, default=1000)
    parser.add_argument("--limit", type=int, default=0, help="Validate at most N nonblank manifest rows; 0 means all")
    args = parser.parse_args()

    root = args.root.resolve()
    manifest_path = (args.manifest or (root / "manifest.jsonl")).resolve()
    summary_path = (args.summary or (root / "qa" / "verification-summary.json")).resolve()
    csv_path = (args.csv or (root / "qa" / "verification-manifest.csv")).resolve()
    if not root.is_dir():
        parser.error(f"archive root not found: {root}")
    if not manifest_path.is_file():
        parser.error(f"manifest not found: {manifest_path}")
    if summary_path == manifest_path or csv_path == manifest_path:
        parser.error("verification output must not overwrite manifest.jsonl")
    try:
        validate_output_path(summary_path, root)
        validate_output_path(csv_path, root)
    except ValueError as exc:
        parser.error(str(exc))

    summary_path.parent.mkdir(parents=True, exist_ok=True)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    csv_temporary = csv_path.with_name(csv_path.name + ".tmp")
    started_at = utc_now()
    started_clock = time.monotonic()
    compute_sha256 = not args.skip_sha256
    error_records_by_pid, unassigned_error_records = index_error_records(root)
    seen_pids: set[int] = set()
    issue_counts: Counter[str] = Counter()
    file_counts: Counter[str] = Counter()
    physical_lines = 0
    blank_lines = 0
    manifest_rows = 0
    valid_manifest_rows = 0
    invalid_manifest_rows = 0
    patterns_ok = 0
    patterns_with_issues = 0
    matrix_cells = 0
    all_partial_files: set[str] = set()

    try:
        with csv_temporary.open("w", encoding="utf-8-sig", newline="") as csv_stream:
            writer = csv.DictWriter(csv_stream, fieldnames=CSV_FIELDS, extrasaction="ignore")
            writer.writeheader()
            for line_number, line in iter_manifest(manifest_path):
                physical_lines += 1
                if not line.strip():
                    blank_lines += 1
                    continue
                manifest_rows += 1
                if args.limit > 0 and manifest_rows > args.limit:
                    break

                try:
                    entry = json.loads(line)
                    if not isinstance(entry, dict):
                        raise ValueError("manifest row is not an object")
                    pid = int(entry["pid"])
                    slug = str(entry.get("slug", ""))
                except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                    invalid_manifest_rows += 1
                    issue_counts["manifest_invalid"] += 1
                    patterns_with_issues += 1
                    writer.writerow(
                        {
                            "line": line_number,
                            "status": "manifest_error",
                            "issues": f"manifest_invalid: {type(exc).__name__}: {exc}",
                        }
                    )
                    continue

                valid_manifest_rows += 1
                issues: list[str] = []
                if pid in seen_pids:
                    issues.append("duplicate_pid")
                else:
                    seen_pids.add(pid)

                pattern_dir = root / "patterns" / f"{pid % 100:02d}" / str(pid)
                if not pattern_dir.is_dir():
                    issues.append("pattern_directory_missing")

                metadata_check, metadata = check_json_file(
                    pattern_dir / "metadata.json", root, compute_sha256
                )
                matrix_check, matrix = check_json_file(
                    pattern_dir / "matrix.json", root, compute_sha256
                )
                add_file_counts(file_counts, "metadata", metadata_check)
                add_file_counts(file_counts, "matrix", matrix_check)
                for prefix, check in (("metadata", metadata_check), ("matrix", matrix_check)):
                    issue = issue_for_check(prefix, check)
                    if issue:
                        issues.append(issue)

                if isinstance(metadata, dict):
                    if metadata.get("pid") != entry.get("pid"):
                        issues.append("metadata_pid_mismatch")
                    if metadata.get("slug") != entry.get("slug"):
                        issues.append("metadata_slug_mismatch")
                    for field in ("detailUrl", "thumbnailUrl", "fullImageUrl"):
                        if metadata.get(field) != entry.get(field):
                            issues.append(f"metadata_{field}_mismatch")
                elif metadata_check["valid"]:
                    metadata_check["valid"] = False
                    issues.append("metadata_not_object")

                cells, matrix_width, matrix_height, bad_keys = matrix_shape(matrix)
                matrix_cells += cells
                if matrix_check["valid"] and not isinstance(matrix, dict):
                    matrix_check["valid"] = False
                    issues.append("matrix_not_object")
                if matrix_check["valid"] and bad_keys:
                    issues.append("matrix_bad_coordinate_keys")

                thumbnail_name = expected_png_name(entry.get("thumbnailUrl"), full=False)
                full_name = expected_png_name(entry.get("fullImageUrl"), full=True)
                if thumbnail_name is None:
                    issues.append("thumbnail_url_missing")
                    thumbnail_path = pattern_dir / "__missing_thumbnail__.png"
                else:
                    thumbnail_path = pattern_dir / thumbnail_name
                if full_name is None:
                    issues.append("full_png_url_missing")
                    full_path = pattern_dir / "__missing_full__.png"
                else:
                    full_path = pattern_dir / full_name

                thumbnail_check = check_png_file(thumbnail_path, root, compute_sha256)
                full_check = check_png_file(full_path, root, compute_sha256)
                add_file_counts(file_counts, "thumbnail", thumbnail_check)
                add_file_counts(file_counts, "fullPng", full_check)
                for prefix, check in (("thumbnail", thumbnail_check), ("full_png", full_check)):
                    issue = issue_for_check(prefix, check)
                    if issue:
                        issues.append(issue)

                error_records = error_records_by_pid.get(pid, [])
                if error_records:
                    issues.append("error_record_present")
                partial_files = find_partial_files(pattern_dir, root)
                all_partial_files.update(partial_files)
                if partial_files:
                    issues.append("partial_file_present")

                unique_issues = list(dict.fromkeys(issues))
                issue_counts.update(unique_issues)
                if unique_issues:
                    patterns_with_issues += 1
                    status = "issues"
                else:
                    patterns_ok += 1
                    status = "ok"

                writer.writerow(
                    {
                        "line": line_number,
                        "pid": pid,
                        "slug": slug,
                        "status": status,
                        "issues": ";".join(unique_issues),
                        "pattern_dir": relative_text(pattern_dir, root),
                        "metadata_path": metadata_check["path"],
                        "metadata_size": metadata_check["size"],
                        "metadata_sha256": metadata_check["sha256"],
                        "metadata_valid": metadata_check["valid"],
                        "matrix_path": matrix_check["path"],
                        "matrix_size": matrix_check["size"],
                        "matrix_sha256": matrix_check["sha256"],
                        "matrix_valid": matrix_check["valid"],
                        "matrix_cells": cells,
                        "matrix_width": matrix_width,
                        "matrix_height": matrix_height,
                        "matrix_bad_keys": bad_keys,
                        "thumbnail_path": thumbnail_check["path"],
                        "thumbnail_size": thumbnail_check["size"],
                        "thumbnail_sha256": thumbnail_check["sha256"],
                        "thumbnail_valid": thumbnail_check["valid"],
                        "thumbnail_width": thumbnail_check["width"],
                        "thumbnail_height": thumbnail_check["height"],
                        "full_png_path": full_check["path"],
                        "full_png_size": full_check["size"],
                        "full_png_sha256": full_check["sha256"],
                        "full_png_valid": full_check["valid"],
                        "full_png_width": full_check["width"],
                        "full_png_height": full_check["height"],
                        "error_records": ";".join(error_records),
                        "partial_files": ";".join(partial_files),
                    }
                )
                del metadata, matrix
                if args.progress_every > 0 and manifest_rows % args.progress_every == 0:
                    print(
                        f"verified {manifest_rows}: ok={patterns_ok} issues={patterns_with_issues}",
                        flush=True,
                    )
        os.replace(csv_temporary, csv_path)
    except BaseException:
        if csv_temporary.exists():
            csv_temporary.unlink()
        raise

    all_partial_files.update(find_archive_partial_files(root))
    orphan_error_records = sorted(
        path
        for pid, paths in error_records_by_pid.items()
        if pid not in seen_pids
        for path in paths
    )
    if all_partial_files:
        issue_counts["archive_partial_file_present"] += len(all_partial_files)
    if unassigned_error_records:
        issue_counts["unassigned_error_record"] += len(unassigned_error_records)
    if orphan_error_records:
        issue_counts["orphan_error_record"] += len(orphan_error_records)
    archive_clean = (
        patterns_with_issues == 0
        and invalid_manifest_rows == 0
        and not all_partial_files
        and not unassigned_error_records
        and not orphan_error_records
    )
    completed_at = utc_now()
    summary = {
        "schemaVersion": 1,
        "root": str(root),
        "manifest": str(manifest_path),
        "startedAt": started_at,
        "completedAt": completed_at,
        "elapsedSeconds": round(time.monotonic() - started_clock, 3),
        "sha256Enabled": compute_sha256,
        "limit": args.limit,
        "manifestLinesRead": physical_lines,
        "blankManifestLines": blank_lines,
        "manifestRowsChecked": min(manifest_rows, args.limit) if args.limit > 0 else manifest_rows,
        "validManifestRows": valid_manifest_rows,
        "invalidManifestRows": invalid_manifest_rows,
        "uniquePids": len(seen_pids),
        "patternsOk": patterns_ok,
        "patternsWithIssues": patterns_with_issues,
        "archiveClean": archive_clean,
        "issueCounts": dict(sorted(issue_counts.items())),
        "fileCounts": dict(sorted(file_counts.items())),
        "matrixCells": matrix_cells,
        "errorRecords": sum(len(paths) for paths in error_records_by_pid.values()),
        "unassignedErrorRecords": unassigned_error_records,
        "orphanErrorRecords": orphan_error_records,
        "partialFiles": sorted(all_partial_files),
        "outputs": {
            "summary": str(summary_path),
            "csv": str(csv_path),
        },
    }
    atomic_write_json(summary_path, summary)
    print(json.dumps(summary, ensure_ascii=False), flush=True)
    return 0 if archive_clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
