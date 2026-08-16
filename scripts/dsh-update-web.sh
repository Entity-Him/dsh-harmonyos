#!/bin/sh
# dsh 设置与更新页(3098):启动/重启。用法: sh scripts/dsh-update-web.sh
NODE="${NODE_BIN:-/data/service/hnp/node.org/node_v24.13.0/bin/node}"
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT=3098
LOG="$HOME/dsh-update-web.log"
PIDF="$HOME/dsh-update-web.pid"

is_up() {
  /usr/bin/curl -s -o /dev/null --fail --max-time 1 "http://127.0.0.1:$PORT/" 2>/dev/null
}
if is_up; then
  echo "dsh-update-web: already running at http://127.0.0.1:$PORT/ (skip)"
  exit 0
fi
ps -ef 2>/dev/null | grep -F "dsh-update-web.mjs" | grep -v grep \
  | awk '{print $2}' | while read p; do kill "$p" 2>/dev/null; done
sleep 0.3
nohup "$NODE" "$DIR/dsh-update-web.mjs" > "$LOG" 2>&1 &
echo $! > "$PIDF"
for i in 1 2 3 4 5 6 7 8 9 10; do
  is_up && break
  sleep 0.3
done
if is_up; then
  echo "dsh-update-web: http://127.0.0.1:$PORT/ (pid $(cat "$PIDF"))"
else
  echo "dsh-update-web: FAILED to start (see $LOG)"
  head -5 "$LOG"
  exit 1
fi
