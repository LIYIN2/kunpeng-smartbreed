#!/usr/bin/env python3
"""Validate WGCNA expression and trait tables."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def read(path: Path) -> tuple[list[str], list[list[str]]]:
    lines = path.read_text(encoding="utf-8-sig").splitlines()
    delimiter = "\t" if lines and "\t" in lines[0] else ","
    rows = list(csv.reader(lines, delimiter=delimiter))
    return (rows[0] if rows else []), rows[1:]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--expression", required=True, type=Path)
    p.add_argument("--traits", required=True, type=Path)
    p.add_argument("--report", type=Path)
    a = p.parse_args(); errors: list[str] = []; warnings: list[str] = []
    for label, path in (("expression", a.expression), ("traits", a.traits)):
        if not path.is_file() or path.stat().st_size == 0: errors.append(f"{label} 不存在或为空: {path}")
    samples: list[str] = []; genes: list[str] = []; trait_ids: list[str] = []
    if not errors:
        eh, er = read(a.expression); th, tr = read(a.traits)
        if len(eh) < 3: errors.append("表达矩阵必须为 gene_id + 至少两个样本列")
        samples = [x.strip() for x in eh[1:]]; genes = [(r[0].strip() if r else "") for r in er]
        trait_ids = [(r[0].strip() if r else "") for r in tr]
        for label, values in (("表达矩阵样本", samples), ("gene_id", genes), ("性状表 sample_id", trait_ids)):
            dup = [x for x, n in Counter(values).items() if x and n > 1]
            if any(not x for x in values): errors.append(f"{label} 存在空 ID")
            if dup: errors.append(f"{label} 重复: {', '.join(sorted(dup)[:10])}")
        width = len(eh)
        bad_numeric = 0
        for row in er:
            if len(row) != width: errors.append(f"表达矩阵行宽不一致: {row[0] if row else '空行'}"); continue
            for value in row[1:]:
                try: float(value)
                except ValueError: bad_numeric += 1
        if bad_numeric: errors.append(f"表达矩阵含 {bad_numeric} 个非数值单元格")
        shared = set(samples) & set(trait_ids)
        if len(shared) != len(samples) or len(shared) != len(trait_ids): errors.append(f"样本未一一对齐: 表达 {len(samples)}，性状 {len(trait_ids)}，交集 {len(shared)}")
        if len(samples) < 15: warnings.append("样本数少于 15，模块稳定性通常较弱；需谨慎解释并做敏感性分析")
        if len(th) < 2: errors.append("性状表没有性状列")
    result = {"ok": not errors, "workflow": "wgcna", "genes": len(genes), "samples": len(samples), "traits": max(0, len(th) - 1) if not errors else 0, "errors": errors, "warnings": warnings}
    payload = json.dumps(result, ensure_ascii=False, indent=2); print(payload)
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True); a.report.write_text(payload + "\n", encoding="utf-8")
    return 0 if not errors else 2


if __name__ == "__main__": raise SystemExit(main())
