#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_ROOT="$HOME/.dsh/control-plane"
APP_DIR="$SERVICE_ROOT/app"
DATA_DIR="$SERVICE_ROOT/data"
LOG_DIR="$HOME/.dsh/logs"
TOKEN_FILE="$SERVICE_ROOT/owner-setup-token.txt"
PLIST="$HOME/Library/LaunchAgents/cn.xmu.fishgenetics.kunpeng-control-plane.plist"
NODE_BIN="$SOURCE_DIR/../kunpeng-agent-desktop/bundle/node-darwin-arm64/bin/node"

if [ ! -x "$NODE_BIN" ]; then
  echo "找不到内置 Node: $NODE_BIN" >&2
  exit 1
fi

mkdir -p "$APP_DIR/public" "$DATA_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
rsync -a "$SOURCE_DIR/server.js" "$SOURCE_DIR/package.json" "$APP_DIR/"
rsync -a "$SOURCE_DIR/public/" "$APP_DIR/public/"

if [ "${KUNPENG_ROTATE_TOKEN:-0}" = "1" ] || [ ! -s "$TOKEN_FILE" ]; then
  umask 077
  "$NODE_BIN" -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))" > "$TOKEN_FILE"
fi
chmod 600 "$TOKEN_FILE"
BOOTSTRAP_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"

python3 - "$PLIST" "$NODE_BIN" "$APP_DIR" "$DATA_DIR/kunpeng.sqlite" "$LOG_DIR" "$BOOTSTRAP_TOKEN" <<'PY'
import plistlib, sys
plist, node, app, database, logs, token = sys.argv[1:]
payload = {
    "Label": "cn.xmu.fishgenetics.kunpeng-control-plane",
    "ProgramArguments": [node, f"{app}/server.js"],
    "WorkingDirectory": app,
    "EnvironmentVariables": {
        "KUNPENG_HOST": "127.0.0.1",
        "KUNPENG_PORT": "4789",
        "KUNPENG_DB_PATH": database,
        "KUNPENG_BOOTSTRAP_TOKEN": token,
    },
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 10,
    "StandardOutPath": f"{logs}/control-plane.out.log",
    "StandardErrorPath": f"{logs}/control-plane.err.log",
}
with open(plist, "wb") as handle:
    plistlib.dump(payload, handle)
PY
chmod 600 "$PLIST"

launchctl bootout "gui/$(id -u)/cn.xmu.fishgenetics.kunpeng-control-plane" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/cn.xmu.fishgenetics.kunpeng-control-plane"

echo "鲲鹏管理中心已安装: http://127.0.0.1:4789"
echo "所有者初始化令牌保存在: $TOKEN_FILE"
