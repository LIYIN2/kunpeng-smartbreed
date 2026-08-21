# RNA-seq 输入契约

## 入口 A：原始 reads

- `samples.csv/tsv`：`sample_id,group,read1,read2,batch`；单端可省略 `read2`，同一项目不可混用单端和双端。
- FASTQ/FASTQ.GZ：文件存在、非空，样本名与样本表一致。
- 参考基因组 FASTA 与 GTF/GFF3：必须记录物种、组装版本、注释版本、下载地址和校验和。
- 实验设计：生物学重复、批次、配对/重复测量关系、计划比较和需要控制的协变量。

## 入口 B：BAM

除元数据和参考版本外，提供坐标排序 BAM、BAI、比对软件/版本/参数和链特异性。先用 `samtools quickcheck` 与汇总统计验收。

## 入口 C：计数矩阵

提供 raw integer counts、基因 ID 列、样本列、生成软件/版本/注释版本。DESeq2 不接收 TPM/TMM。若只有 TPM，仅允许探索性可视化，不能补造差异表达结果。

## 计算环境

生产计算优先 Linux/HPC、WSL2 或经过验证的容器/conda 环境；Windows 桌面 UI 负责项目登记和预检，不代表本机能直接运行全部生信工具。
