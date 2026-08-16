#!/usr/bin/env python3
"""Kunpeng SmartBreed — 近交系数计算器（Tabular 法）

基于谱系文件计算每个个体的近交系数 F 与共祖系数矩阵。

输入格式（CSV，UTF-8）：
    id,father,mother
    1001,,          # 基础群个体，无亲本
    1002,,
    2001,1001,1002  # 子代引用亲本 ID

用法：
    python3 inbreeding.py pedigree.csv
    python3 inbreeding.py pedigree.csv --output result.csv

输出：
    id,F(inbreeding)

仅依赖 Python 标准库，可离线运行。
"""

from __future__ import annotations

import argparse
import csv
import sys
from collections import OrderedDict


def parse_pedigree(path: str):
    """读取谱系 CSV，返回 (ids, sires, dams)。未知亲本用 None 表示。"""
    ids: list[str] = []
    sires: dict[str, str | None] = {}
    dams: dict[str, str | None] = {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            iid = (row.get("id") or "").strip()
            if not iid:
                continue
            sire = (row.get("father") or row.get("sire") or "").strip() or None
            dam = (row.get("mother") or row.get("dam") or "").strip() or None
            ids.append(iid)
            sires[iid] = sire
            dams[iid] = dam
    if not ids:
        raise ValueError("谱系为空：未读到任何个体")
    return ids, sires, dams


def inbreeding(ids, sires, dams):
    """Tabular 法计算近交系数。返回 {id: F}。"""
    # 建立索引，确保亲本先于后代排序
    known = set(ids)
    ordered: list[str] = []
    for iid in ids:
        if iid not in known:
            continue
        ordered.append(iid)

    # 数值索引
    idx = {iid: i for i, iid in enumerate(ordered)}
    n = len(ordered)

    # A 矩阵（共祖系数，按行填充）
    A = [[0.0] * n for _ in range(n)]
    F = {}

    for i, iid in enumerate(ordered):
        s = sires.get(iid)
        d = dams.get(iid)
        s_idx = idx.get(s) if s in idx else None
        d_idx = idx.get(d) if d in idx else None

        if s_idx is None and d_idx is None:
            # 基础群个体：A_ii = 1
            A[i][i] = 1.0
            F[iid] = 0.0
            continue

        # 填充该个体行（j < i）
        for j in range(i):
            a_sj = A[s_idx][j] if s_idx is not None and s_idx < n else 0.0
            a_dj = A[d_idx][j] if d_idx is not None and d_idx < n else 0.0
            A[i][j] = 0.5 * (a_sj + a_dj)
            A[j][i] = A[i][j]

        if s_idx is not None and d_idx is not None and s_idx < n and d_idx < n:
            A[i][i] = 1.0 + 0.5 * A[s_idx][d_idx]
        else:
            A[i][i] = 1.0

        # 近交系数 F = A_ii - 1
        F[iid] = max(0.0, A[i][i] - 1.0)

    return F, A


def main() -> int:
    ap = argparse.ArgumentParser(description="鲲鹏智育 · 近交系数计算器（Tabular 法）")
    ap.add_argument("pedigree", help="谱系 CSV 文件路径（列: id,father,mother）")
    ap.add_argument("--output", "-o", default=None, help="输出 CSV 路径（默认打印到标准输出）")
    args = ap.parse_args()

    try:
        ids, sires, dams = parse_pedigree(args.pedigree)
    except Exception as exc:  # noqa: BLE001
        print(f"错误：无法读取谱系文件 - {exc}", file=sys.stderr)
        return 1

    F, _A = inbreeding(ids, sires, dams)

    lines = [["id", "F_inbreeding"]]
    for iid in ids:
        lines.append([iid, f"{F[iid]:.4f}"])

    if args.output:
        with open(args.output, "w", newline="", encoding="utf-8") as fh:
            csv.writer(fh).writerows(lines)
        print(f"已写入 {args.output}（{len(ids)} 个个体）")
    else:
        for row in lines:
            print(",".join(row))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
