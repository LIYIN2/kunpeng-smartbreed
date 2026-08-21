#!/usr/bin/env bash
# 一键构建:macOS dmg + Windows x64 exe
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

[ -d node_modules ] || npm install
bash scripts/prepare-bundle.sh

CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --win --x64

echo "==> 构建完成,产物位于 ../outputs/dist/"
