#!/usr/bin/env python3
"""Validate an RNA-seq sample sheet and reference files without external packages."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def table(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    text = path.read_text(encoding="utf-8-sig")
    delimiter = "\t" if "\t" in text.partition("\n")[0] else ","
    reader = csv.DictReader(text.splitlines(), delimiter=delimiter)
    return list(reader.fieldnames or []), [{k: (v or "").strip() for k, v in row.items()} for row in reader]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--samplesheet", required=True, type=Path)
    parser.add_argument("--reference", required=True, type=Path)
    parser.add_argument("--annotation", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    errors: list[str] = []
    warnings: list[str] = []
    for label, path in (("samplesheet", args.samplesheet), ("reference", args.reference), ("annotation", args.annotation)):
        if not path.is_file() or path.stat().st_size == 0:
            errors.append(f"{label} 不存在或为空: {path}")
    rows: list[dict[str, str]] = []
    fields: list[str] = []
    if not errors:
        fields, rows = table(args.samplesheet)
        required = {"sample_id", "group", "read1"}
        missing = sorted(required - set(fields))
        if missing:
            errors.append(f"样本表缺少列: {', '.join(missing)}")
        ids = [row.get("sample_id", "") for row in rows]
        duplicates = sorted(key for key, count in Counter(ids).items() if key and count > 1)
        if any(not value for value in ids): errors.append("样本表存在空 sample_id")
        if duplicates: errors.append(f"重复 sample_id: {', '.join(duplicates)}")
        paired_values = {bool(row.get("read2")) for row in rows}
        if len(paired_values) > 1: errors.append("read2 不能只在部分样本中填写")
        for row in rows:
            for column in ("read1", "read2"):
                value = row.get(column, "")
                if value and (not Path(value).is_file() or Path(value).stat().st_size == 0):
                    errors.append(f"{row.get('sample_id')}: {column} 不存在或为空: {value}")
        groups = Counter(row.get("group", "") for row in rows)
        if "" in groups: errors.append("样本表存在空 group")
        small = sorted(group for group, count in groups.items() if group and count < 3)
        if small: warnings.append(f"以下组少于 3 个生物学重复: {', '.join(small)}")
        if not rows: errors.append("样本表没有数据行")
    result = {"ok": not errors, "workflow": "rnaseq", "samples": len(rows), "columns": fields, "errors": errors, "warnings": warnings}
    payload = json.dumps(result, ensure_ascii=False, indent=2)
    print(payload)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(payload + "\n", encoding="utf-8")
    return 0 if not errors else 2


if __name__ == "__main__":
    raise SystemExit(main())
