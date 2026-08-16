#!/bin/sh
# dsh 检查更新：终端一键。用法: sh scripts/dsh-update.sh [check|patch|install|rollback]
NODE="${NODE_BIN:-/data/service/hnp/node.org/node_v24.13.0/bin/node}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$NODE" "$SCRIPT_DIR/dsh-update.mjs" "$@"
