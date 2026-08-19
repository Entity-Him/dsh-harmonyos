#!/bin/sh
# dsh web 服务:启动/重启 (127.0.0.1:3080)。
# 环境变量可覆盖: NODE_BIN(节点路径) DSH_DIR(dsh 安装目录) PATCH_YML(适配补丁) PORT
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE="${NODE_BIN:-/data/service/hnp/node.org/node_v24.13.0/bin/node}"
DIR="${DSH_DIR:-$HOME/dsh-test}"
PATCH="${PATCH_YML:-$SCRIPT_DIR/../harmony.patch.yml}"
PORT="${PORT:-3080}"
LOG="${LOG:-$HOME/dsh-web.log}"
PIDF="$HOME/dsh-web.pid"

is_up() {
  /usr/bin/curl -s -o /dev/null --fail --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null
}

# —— 自动部署（幂等）：缺啥补啥，跑一次即可 ——
REPO_PRESETS="$SCRIPT_DIR/../presets"
PRESET_DIR="$HOME/.dsh/.agent-presets"

if [ ! -d "$DIR/node_modules/@deepseek-ai/dsh" ]; then
  echo "dsh-web: dsh not installed at $DIR"
  echo "  run: cd $DIR && npm install @deepseek-ai/dsh"
  exit 1
fi

# 部署鸿蒙对话模式预设（六套 harmony-*，缺哪个拷哪个）
if [ -d "$REPO_PRESETS" ]; then
  mkdir -p "$PRESET_DIR"
  for p in "$REPO_PRESETS"/*/; do
    [ -d "$p" ] || continue
    name=$(basename "$p")
    if [ ! -d "$PRESET_DIR/$name" ]; then
      cp -r "$p" "$PRESET_DIR/$name" 2>/dev/null && echo "dsh-web: deployed preset $name"
    fi
  done
fi

# 用户默认对话模式：未配置时设为 harmony-chat-promax
if [ -f "$HOME/.dsh/settings.yaml" ]; then
  grep -q "default:" "$HOME/.dsh/settings.yaml" 2>/dev/null || \
    printf "agent-presets:\n  default: harmony-chat-promax\n" >> "$HOME/.dsh/settings.yaml"
else
  printf "agent-presets:\n  default: harmony-chat-promax\n" >> "$HOME/.dsh/settings.yaml"
fi

if is_up; then
  echo "dsh-web: already running at http://127.0.0.1:$PORT/ (skip)"
  exit 0
fi

cd "$DIR" || { echo "dsh-web: no dir $DIR"; exit 1; }
ps -ef 2>/dev/null | grep -F "dsh/lib/bin.js" | grep -v grep \
  | awk '{print $2}' | while read p; do kill "$p" 2>/dev/null; done
sleep 0.3

nohup "$NODE" --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile web --patch "$PATCH" > "$LOG" 2>&1 &
echo $! > "$PIDF"

for i in 1 2 3 4 5 6 7 8 9 10; do
  is_up && break
  sleep 0.3
done

if is_up; then
  echo "dsh-web: http://127.0.0.1:$PORT/ (pid $(cat "$PIDF"))"
else
  echo "dsh-web: FAILED to start (see $LOG)"
  head -5 "$LOG"
  exit 1
fi
