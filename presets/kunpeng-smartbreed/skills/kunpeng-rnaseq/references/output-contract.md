# RNA-seq 结果交付契约

- `00_preflight/`：预检 JSON、输入清单、校验和。
- `01_qc/`：FastQC/MultiQC 与 fastp 原始报告。
- `02_alignment/`：排序 BAM/索引及逐样本比对统计。
- `03_counts/`：raw count matrix、注释字段、定量汇总。
- `04_exploration/`：PCA、相关性、样本距离及审查记录。
- `05_differential/`：每个预设 contrast 的完整表、摘要和图。
- `06_enrichment/`：完整富集表、背景、映射率、数据库版本和图。
- `logs/`、`config/`、`manifest.json`：命令、版本、参数、退出码、输入输出及校验和。

完成门槛：必需阶段退出码为 0、目标产物非空、样本数一致、报告中没有未处理的阻断错误。图不能代替底层表格。
