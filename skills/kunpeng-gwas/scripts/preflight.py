#!/usr/bin/env python3
"""Validate GWAS genotype sample, phenotype, and optional covariate tables."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path


def rows(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    text = path.read_text(encoding="utf-8-sig"); d = "\t" if "\t" in text.partition("\n")[0] else ","
    r = csv.DictReader(text.splitlines(), delimiter=d)
    return list(r.fieldnames or []), [{k: (v or "").strip() for k, v in x.items()} for x in r]


def ids(data: list[dict[str, str]], field: str, label: str, errors: list[str]) -> list[str]:
    values = [x.get(field, "") for x in data]
    dup = [x for x, n in Counter(values).items() if x and n > 1]
    if any(not x for x in values): errors.append(f"{label} 存在空 {field}")
    if dup: errors.append(f"{label} 重复 ID: {', '.join(sorted(dup)[:10])}")
    return values


def main() -> int:
    p = argparse.ArgumentParser(); p.add_argument("--samples", required=True, type=Path); p.add_argument("--phenotype", required=True, type=Path); p.add_argument("--trait", required=True); p.add_argument("--covariates", type=Path); p.add_argument("--report", type=Path); a = p.parse_args()
    errors: list[str] = []; warnings: list[str] = []
    paths = [("samples", a.samples), ("phenotype", a.phenotype)] + ([] if a.covariates is None else [("covariates", a.covariates)])
    for label, path in paths:
        if not path.is_file() or path.stat().st_size == 0: errors.append(f"{label} 不存在或为空: {path}")
    shared: set[str] = set(); genotype_ids: list[str] = []; phenotype_ids: list[str] = []
    if not errors:
        sh, sr = rows(a.samples); ph, pr = rows(a.phenotype)
        sample_field = "sample_id" if "sample_id" in sh else (sh[0] if sh else "sample_id")
        if "sample_id" not in ph: errors.append("表型表缺少 sample_id 列")
        if a.trait not in ph: errors.append(f"表型表缺少目标性状列: {a.trait}")
        genotype_ids = ids(sr, sample_field, "基因型样本表", errors); phenotype_ids = ids(pr, "sample_id", "表型表", errors)
        if a.trait in ph:
            missing = sum(not row.get(a.trait, "") for row in pr)
            bad = 0
            for row in pr:
                if row.get(a.trait, ""):
                    try: float(row[a.trait])
                    except ValueError: bad += 1
            if missing: warnings.append(f"目标性状缺失 {missing} 个")
            if bad: errors.append(f"目标性状含 {bad} 个非数值值")
        shared = set(genotype_ids) & set(phenotype_ids)
        if not shared: errors.append("基因型与表型没有可对齐个体")
        if len(shared) < len(set(phenotype_ids)): warnings.append(f"有 {len(set(phenotype_ids)) - len(shared)} 个表型个体无基因型")
        if a.covariates:
            ch, cr = rows(a.covariates)
            if "sample_id" not in ch: errors.append("协变量表缺少 sample_id 列")
            else:
                cov_ids = set(ids(cr, "sample_id", "协变量表", errors))
                absent = len(shared - cov_ids)
                if absent: errors.append(f"有 {absent} 个分析个体缺少协变量记录")
    result = {"ok": not errors, "workflow": "gwas", "genotype_samples": len(genotype_ids), "phenotype_samples": len(phenotype_ids), "aligned_samples": len(shared), "errors": errors, "warnings": warnings}
    payload = json.dumps(result, ensure_ascii=False, indent=2); print(payload)
    if a.report:
        a.report.parent.mkdir(parents=True, exist_ok=True); a.report.write_text(payload + "\n", encoding="utf-8")
    return 0 if not errors else 2


if __name__ == "__main__": raise SystemExit(main())
