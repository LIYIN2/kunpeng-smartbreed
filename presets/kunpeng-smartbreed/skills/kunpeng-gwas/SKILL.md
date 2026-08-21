---
name: kunpeng-gwas
description: GWAS 项目从基因型、表型与协变量对齐，经过样本和标记质控、群体结构与亲缘校正、关联模型、显著性控制到候选区域交付的受控流程。用户提供 VCF/PLINK 与表型并要求关联分析时使用。
---

# 鲲鹏 GWAS 分析

以个体 ID 对齐和模型假设为核心，不在数据门禁未通过时启动关联分析。

## 执行顺序

1. 读取 `references/input-contract.md`，确认基因型格式/版本、表型性状、单位、固定效应、批次和协变量。
2. 从 VCF/PLINK 导出样本清单后运行：

   `python scripts/preflight.py --samples <genotype_samples.tsv> --phenotype <phenotype.tsv> --trait <column> [--covariates covariates.tsv] --report <project>/00_preflight/report.json`

3. 修正重复、缺失和样本错配后，按 `references/workflow.md` 执行基因型质控、PCA/亲缘矩阵、模型诊断、关联检验与候选区域注释。
4. 保留实际软件、版本、阈值、过滤前后统计、命令、日志和所有中间清单。
5. 验收 Manhattan/QQ 图、通胀指标、完整关联结果、效应量、等位基因频率和候选区域证据。

## 门禁

- 不在未核对等位基因方向、基因组版本、染色体命名时合并或注释数据。
- 不用同一批数据反复选择阈值后仍声称检验独立。
- 显著阈值、群体结构和亲缘校正必须结合数据设计说明，不能只套固定参数。
- 候选基因只是位置和证据支持的候选，不等同于已验证因果基因。
