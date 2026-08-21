# 鲲鹏智育 Kunpeng SmartBreed

面向 **大黄鱼（*Larimichthys crocea*）遗传育种** 的科研智能体，**以开源 DeepSeek Harness 为底层平台制作**，是「鲲鹏」育种领域模型的工程落地。

<p align="center">
  <img src="assets/kunpeng-logo-512.png" width="160" alt="鲲鹏智育 Logo">
</p>

> 名字由来：**鲲鹏** —— 取《庄子·逍遥游》「北冥有鱼，其名为鲲……化而为鸟，其名为鹏」。**鲲** 是大鱼，**鹏** 是徐鹏老师课题组，暗合「大黄鱼 + 遗传育种」的身份；**智育** —— AI 智慧育种。
> English: **Kun** = the great fish, **Peng** = Prof. Xu Peng's lab, **SmartBreed** = AI-driven breeding.

## 它是什么

## 设计定位

**鲲鹏模型 = DeepSeek Harness（底层） + DeepSeek 等基础模型（推理底座） + 育种领域知识库（references） + 专家工作流（技能）**。

DeepSeek Harness 是开源的 Agent 运行时，提供模型路由、工具调用、技能注册、会话管理、审批与沙箱等基础设施；本项目在其上构建「鲲鹏」领域模型：注入大黄鱼育种知识、封装科研工作流、约束模型输出规范，让基础模型以「大黄鱼育种专家」的身份完成文献检索、组学分析、数据治理与选配决策。更换底层模型（DeepSeek / 其他 OpenAI 兼容 API / 本地模型）即可迁移，领域层不变。

鲲鹏智育以 **DeepSeek Harness 智能体预设（Agent Preset）+ 专业技能包 + 课题组知识库** 的形式分发，让 dsh 会话以「大黄鱼育种专家」的身份工作，覆盖科研全流程：

| 模块 | 能力 |
|---|---|
| 文献知识检索与问答 | 先检索证据再回答，强制返回来源/DOI/原文片段；无证据明示「尚无充分证据」 |
| 组学与数据分析工作流 | RNA-seq / GWAS / 基因组选择（GS）等受控流程，输入确认 + 可复现实验记录 |
| 育种数据治理 | 以「个体」为中心的数据模型、六类基础质控、暂存—校验—审核—入库闭环 |
| 全基因组选育 | 基因型质控、GBLUP/ssGBLUP、GEBV、模型验证、多性状选择与近交约束 |
| 课题组知识库问答 | 内置实验安全与操作规范、仪器与实验技术、养殖与鱼排管理、送测与种质鉴定、繁育计划、数据档案等课题组内部知识 |

恪守四项原则：**证据可追溯、计算可复现、决策可解释、数据可治理**。模型是对话入口与结果解释器，不是事实与决策的唯一来源。

## 版本

- v2.2.0（当前）：鲲鹏桌面应用底层 UI、可检索知识中心、日常科研任务台、全基因组选育输入门禁、标准化知识治理与专家材料入库。
- v1.0.1：课题组知识库补充。
- v1.0.0：智能体预设 + 专业技能 + 课题组知识库 + 近交系数计算工具。

## 快速开始

### 1. 安装到 DeepSeek Harness

运行一键安装脚本（自动将预设、技能与知识库复制到 dsh 对应目录）：

    bash scripts/install.sh          # macOS / Linux
    powershell -ExecutionPolicy Bypass -File scripts/install.ps1   # Windows

也可以手动复制：

    cp -r presets/kunpeng-smartbreed <dsh目录>/apps/cli/config/agent-presets/
    cp -r skills/kunpeng-* <dsh目录>/.agents/skills/
    mkdir -p <dsh目录>/.agents/knowledge && cp knowledge/md/*.md <dsh目录>/.agents/knowledge/

> 安装后重启 dsh，在智能体界面即可看到新预设「**鲲鹏智育**」。

### 2. 使用

- 在智能体界面选择预设「鲲鹏智育」开启育种专家会话。
- **文献问答**：直接提问（如「大黄鱼抗病基因研究进展」），智能体按证据引用规范回答。
- **课题组知识问答**：提问实验操作、流程或联系人（如「PIT 注射的步骤是什么」「芯片送测找谁」），智能体检索内置知识库回答并注明来源页面。
- **近交分析**：`python3 tools/inbreeding.py pedigree.csv` 计算近交系数。
- **选配建议**：提供谱系/表型/基因型数据，智能体生成多套选配方案供专家审核。

## 课题组知识库

内置知识来自课题组腾讯文档知识空间（《大黄鱼育种组》），随预设分发（`skills/kunpeng-knowledge/references/`），同时保留仓库级副本 `knowledge/md/`：

| 分类 | 文件 |
|---|---|
| 实验安全与操作规范 | 实验室安全与管理规范、养殖规范、PIT注射操作规范、常见病害防治 |
| 仪器与实验技术 | 实验室仪器的使用方法及其注意事项、常用实验技术方法及注意事项（石蜡切片/分子克隆/基因组选择/基因编辑/测鱼宝/YOLO-feed/游泳能力/心率/三倍体/代谢）、养殖实验相关装置使用规范 |
| 日常事务 | 近期工作、拉鱼/用池计划、实验安排、2026 繁育计划、鱼排管理、芯片送测、种质鉴定、物资盘点 |
| 数据档案 | 重测序数据位置、已发表公开基因组数据（NCBI/NGDC 登录号） |

### 如何添加/更新知识

1. 复制 [`templates/knowledge-entry.md`](templates/knowledge-entry.md)，填写来源、页码/章节、适用范围、敏感等级和复审人。
2. 按 [`docs/KNOWLEDGE_GOVERNANCE.md`](docs/KNOWLEDGE_GOVERNANCE.md) 将事实、专家意见、整理者解释和推断分开；新提交默认为 `draft`。
3. 负责人核对原文后改为 `reviewed`，再同步到仓库知识目录、技能 references 和智能体预设。
4. 重新运行 `scripts/install.sh`（或复制预设）后重启应用。

> 无原文定位、未分离推断、或涉及正式育种/安全/对外申报却未经审核的内容，不得进入正式知识库。

## 工具

### tools/inbreeding.py — 近交系数计算器

Tabular 法计算近交系数与共祖矩阵，纯标准库、可离线运行。

    python3 tools/inbreeding.py pedigree.csv
    python3 tools/inbreeding.py pedigree.csv -o result.csv

输入 CSV：`id,father,mother`（未知亲本留空）。输出：每个个体的近交系数 F。

## 目录结构

    kunpeng-smartbreed/
    ├── presets/kunpeng-smartbreed/   # dsh Agent Preset（persona + 工具组合）
    │   ├── preset.yml                # 预设元数据
    │   └── agent.cordis.yml          # 智能体组合定义（系统提示词 + 工具）
    ├── skills/                       # 专业技能（SKILL.md）
    │   ├── kunpeng-literature/       # 文献知识检索与问答
    │   ├── kunpeng-workflow/         # 组学与数据分析工作流
    │   ├── kunpeng-governance/       # 育种数据治理
    │   ├── kunpeng-genomic-selection/ # 全基因组选育
    │   └── kunpeng-knowledge/        # 课题组知识库技能
    ├── knowledge/                    # 课题组知识库
    │   ├── md/                       # 结构化知识页面（Markdown）
    │   └── raw/                      # 腾讯文档原始抓取文本
    ├── tools/                        # 育种计算工具
    │   └── inbreeding.py             # 近交系数计算器
    └── scripts/                      # 一键安装脚本

## 设计依据

本智能体按《大黄鱼智能育种 AI 平台建设方案》设计，覆盖：文献知识、组学分析、育种数据管理、选配决策的一体化科研智能系统；以课题组数据资产和经过验证的科研流程为核心，构建可追溯、可复现、可审核的智能育种平台。

## 声明

- 本项目为科研辅助工具：所有文献结论、分析结果与选配建议须由领域专家审核后用于实际决策。
- 课题组知识库仅供课题组内部使用，涉及内部流程、联系人、采购与数据位置等信息请勿对外传播。
- 与 DeepSeek 官方无隶属关系；DeepSeek Harness 为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 开源项目。
- 许可证：MIT
