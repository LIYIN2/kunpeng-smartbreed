#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUNDLE="$ROOT/bundle"
DSH_SRC="${DSH_SRC:?请设置 DSH_SRC}"
KP_SRC="${KP_SRC:?请设置 KP_SRC}"
NODE_SRC="${NODE_SRC:?请设置 NODE_SRC}"

if [ ! -d "$DSH_SRC/apps/cli/src" ]; then
  echo "Harness 源码无效: $DSH_SRC" >&2
  exit 1
fi
if [ ! -d "$KP_SRC/presets/kunpeng-smartbreed" ]; then
  echo "鲲鹏智能体源码无效: $KP_SRC" >&2
  exit 1
fi
if [ ! -x "$NODE_SRC/bin/node" ]; then
  echo "Node 运行时无效: $NODE_SRC" >&2
  exit 1
fi

mkdir -p "$BUNDLE"
rm -rf "$BUNDLE/dsh" "$BUNDLE/node-darwin-arm64"
mkdir -p "$BUNDLE/dsh"
rsync -a --exclude node_modules --exclude .git --exclude '*.tsbuildinfo' "$DSH_SRC/" "$BUNDLE/dsh/"

APP_VERSION="$(node -p "require('$ROOT/package.json').version")"
printf '%s\n' "$APP_VERSION" > "$BUNDLE/dsh/.desktop-version"

rm -rf "$BUNDLE/dsh/apps/cli/config/agent-presets/huangpeng-smartbreed" "$BUNDLE/dsh/apps/cli/config/agent-presets/kunpeng-smartbreed"
cp -R "$KP_SRC/presets/kunpeng-smartbreed" "$BUNDLE/dsh/apps/cli/config/agent-presets/"
mkdir -p "$BUNDLE/dsh/.agents/skills" "$BUNDLE/dsh/.agents/knowledge"
cp -R "$KP_SRC"/skills/kunpeng-* "$BUNDLE/dsh/.agents/skills/"
cp "$KP_SRC"/knowledge/md/*.md "$BUNDLE/dsh/.agents/knowledge/"
cp -R "$NODE_SRC" "$BUNDLE/node-darwin-arm64"

echo "鲲鹏 macOS bundle 已就绪: version=$APP_VERSION"
