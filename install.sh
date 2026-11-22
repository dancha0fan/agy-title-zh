#!/usr/bin/env sh
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="scripts/install.mjs"
if [ "${1:-}" = "--uninstall" ]; then
  SCRIPT="scripts/uninstall.mjs"
  shift
fi

pick_node() {
  for candidate in "$(command -v node 2>/dev/null || true)" "$HOME/Library/Application Support/Antigravity/bin/agy-node" "${XDG_CONFIG_HOME:-$HOME/.config}/Antigravity/bin/agy-node"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    if "$candidate" -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" 2>/dev/null; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN=$(pick_node || true)
if [ -z "$NODE_BIN" ]; then
  echo "未找到可用的 Node.js (>= 22.13)，请先安装 Node.js 或启动一次 Antigravity。" >&2
  exit 1
fi
exec "$NODE_BIN" "$DIR/$SCRIPT" "$@"
