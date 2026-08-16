#!/usr/bin/env bash
# 鲲鹏智育 Kunpeng SmartBreed — 安装到 DeepSeek Harness
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"

# 定位 dsh 目录：优先 ~/.dsh/runtime/dsh（桌面应用运行副本），否则当前目录下的 dsh
DSH_DIR="${DSH_DIR:-}"
if [ -z "$DSH_DIR" ]; then
  if [ -d "$HOME/.dsh/runtime/dsh/apps/cli" ]; then
    DSH_DIR="$HOME/.dsh/runtime/dsh"
  elif [ -d "$HERE/../dsh/apps/cli" ]; then
    DSH_DIR="$HERE/../dsh"
  else
    echo "错误：找不到 dsh 目录。请设置环境变量 DSH_DIR 指向 dsh 源码目录。" >&2
    exit 1
  fi
fi

PRESET_DIR="$DSH_DIR/apps/cli/config/agent-presets"
SKILL_DIR="$DSH_DIR/.agents/skills"
KNOWLEDGE_DIR="$DSH_DIR/.agents/knowledge"

echo "安装到: $DSH_DIR"

# 1. 安装预设
if [ -d "$PRESET_DIR" ]; then
  cp -R "$HERE/presets/kunpeng-smartbreed" "$PRESET_DIR/"
  echo "✓ 预设已安装: 鲲鹏智育"
else
  echo "警告：未找到 agent-presets 目录，跳过预设安装: $PRESET_DIR" >&2
fi

# 2. 安装技能
if [ -d "$SKILL_DIR" ]; then
  mkdir -p "$KNOWLEDGE_DIR"
  cp -R "$HERE"/skills/kunpeng-* "$SKILL_DIR/"
  cp -R "$HERE"/knowledge/md/*.md "$KNOWLEDGE_DIR/"
  echo "✓ 技能已安装: kunpeng-literature / kunpeng-workflow / kunpeng-governance / kunpeng-mating / kunpeng-knowledge"
  echo "✓ 知识库已安装: $KNOWLEDGE_DIR"
else
  echo "警告：未找到 skills 目录，跳过技能安装: $SKILL_DIR" >&2
fi

echo ""
echo "完成！重启 dsh 后，在智能体界面选择预设「鲲鹏智育」即可使用。"
