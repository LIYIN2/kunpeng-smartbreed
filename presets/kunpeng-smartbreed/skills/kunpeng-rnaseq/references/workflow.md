# RNA-seq 白名单流程

1. 数据接收：保存校验和、样本表和只读原始数据清单。公共数据优先 `fasterq-dump` 或 ENA 下载，不再把 `fastq-dump` 作为默认方案。
2. 原始质控：FastQC + MultiQC；记录 reads 数、碱基质量、接头、GC、重复和异常样本。
3. 清洗：fastp 参数写入配置；保留 JSON/HTML。清洗不是固定必选项，需由 QC 证据决定。
4. 比对：HISAT2 或 STAR 二选一并锁定索引版本；避免保存巨大 SAM，输出排序 BAM 和比对统计。
5. 定量：Subread featureCounts 或经准入的等价工具；确认链特异性、feature type 与 gene attribute。
6. 探索：样本相关、PCA、批次与异常样本；从模型中删样本必须记录依据并审批。
7. 差异表达：DESeq2 使用 raw counts 和明确设计公式/contrast；报告效应量、FDR、独立过滤和收缩方法。
8. 注释与富集：报告 ID 转换覆盖率、背景基因集、数据库版本、FDR；GSEA 使用预先声明的排序统计量。
9. 可选扩展：Mfuzz/时间序列、WGCNA 转交专项 skill，不在主流程中自动启用。

任何软件或阈值都应写入项目 YAML，不把原稿中的服务器路径、样本名或阈值硬编码进生产流程。
