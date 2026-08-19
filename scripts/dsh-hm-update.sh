#!/bin/sh
# dsh-harmonyos 一键更新:官方 dsh 升级 + 本仓库预设/插件/补丁同步。
# 用法: sh scripts/dsh-hm-update.sh [check|update]   （默认 update）
NODE="${NODE_BIN:-/data/service/hnp/node.org/node_v24.13.0/bin/node}"
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$NODE" "$SCRIPT_DIR/dsh-hm-update.mjs" "$@"
