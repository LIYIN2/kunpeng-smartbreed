#!/usr/bin/env bash
# 准备 electron-builder 所需的 bundle/:
#   - 同步本地 DSH 源码(排除 node_modules/.git/tsbuildinfo)
#   - 下载 macOS arm64 与 Windows x64 的 Node.js 运行时
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v25.8.1}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/bundle"
DSH_SRC="${DSH_SRC:-$ROOT/../dsh}"

if [ ! -d "$DSH_SRC/apps/cli/src" ]; then
  echo "未找到 DeepSeek Harness 源码: $DSH_SRC"
  echo "请先执行: git clone https://github.com/deepseek-ai/deepseek-harness.git $DSH_SRC"
  echo "并在其中执行 pnpm install && pnpm run build"
  exit 1
fi

echo "==> 同步 DSH 源码 -> $BUNDLE/dsh"
rm -rf "$BUNDLE/dsh"
mkdir -p "$BUNDLE/dsh"
rsync -a --exclude node_modules --exclude .git --exclude '*.tsbuildinfo' "$DSH_SRC/" "$BUNDLE/dsh/"

# 写入桌面版版本标记:新版安装时据此刷新 ~/.dsh/runtime 副本
APP_VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 'dev')"
echo "$APP_VERSION" > "$BUNDLE/dsh/.desktop-version"

# 内置鲲鹏智育（大黄鱼育种科研智能体）：预设 + 技能 + 课题组知识库
KP_SRC="${KP_SRC:-$ROOT/../kunpeng-smartbreed}"
if [ -d "$KP_SRC/presets/kunpeng-smartbreed" ]; then
  echo "==> 内置鲲鹏智育智能体 -> bundle/dsh"
  # 清理已被鲲鹏智育取代的旧黄鹏智育预设/技能
  rm -rf "$BUNDLE/dsh/apps/cli/config/agent-presets/huangpeng-smartbreed"
  rm -rf "$BUNDLE"/dsh/.agents/skills/huangpeng-*
  cp -R "$KP_SRC/presets/kunpeng-smartbreed" "$BUNDLE/dsh/apps/cli/config/agent-presets/"
  mkdir -p "$BUNDLE/dsh/.agents/skills" "$BUNDLE/dsh/.agents/knowledge"
  cp -R "$KP_SRC"/skills/kunpeng-* "$BUNDLE/dsh/.agents/skills/"
  cp "$KP_SRC"/knowledge/md/*.md "$BUNDLE/dsh/.agents/knowledge/"
  echo "   预设: kunpeng-smartbreed  技能: $(ls "$KP_SRC"/skills | grep -c kunpeng) 个  知识库: $(ls "$KP_SRC"/knowledge/md/*.md | wc -l | tr -d ' ') 个文件"
else
  echo "警告: 未找到 kunpeng-smartbreed 源码($KP_SRC)，跳过内置鲲鹏智育" >&2
fi

echo "==> 下载 Node $NODE_VERSION (darwin-arm64)"
curl -sSL -o /tmp/node-mac.tar.gz "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-darwin-arm64.tar.gz"
rm -rf "$BUNDLE/node-darwin-arm64"
mkdir -p "$BUNDLE/node-darwin-arm64"
tar -xzf /tmp/node-mac.tar.gz -C "$BUNDLE/node-darwin-arm64" --strip-components=1

echo "==> 下载 Node $NODE_VERSION (win-x64)"
curl -sSL -o /tmp/node-win.zip "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-win-x64.zip"
rm -rf "$BUNDLE/node-win-x64" /tmp/node-win-x64
mkdir -p "$BUNDLE/node-win-x64" /tmp/node-win-x64
unzip -q /tmp/node-win.zip -d /tmp/node-win-x64
mv "/tmp/node-win-x64/node-$NODE_VERSION-win-x64/"* "$BUNDLE/node-win-x64/"
rm -rf /tmp/node-win-x64 /tmp/node-mac.tar.gz /tmp/node-win.zip

echo "==> bundle 就绪"
