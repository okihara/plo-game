#!/bin/bash
# Bot再起動スクリプト
# Usage: ./scripts/restart-bots.sh [--stop-only] [BOT_COUNT] [SERVER_URL]
#
# Examples:
#   ./scripts/restart-bots.sh              # 既定件数で再起動
#   ./scripts/restart-bots.sh --stop-only  # 停止のみ（再起動しない）
#   ./scripts/restart-bots.sh 30           # 30体で再起動

STOP_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --stop-only|-s)
      STOP_ONLY=true
      shift
      ;;
    *)
      break
      ;;
  esac
done

BOT_COUNT=${1:-20}
SERVER_URL=${2:-https://baby-plo.up.railway.app}

stop_bots() {
  PIDS=$(pgrep -f "src/bot/index.ts" || true)
  if [ -z "$PIDS" ]; then
    echo "実行中のbotプロセスなし"
    return
  fi

  echo "既存のbotプロセスを停止: $PIDS"
  kill $PIDS 2>/dev/null || true

  # SIGTERM で graceful shutdown を待つ（最大5秒）
  for _ in {1..10}; do
    sleep 0.5
    PIDS=$(pgrep -f "src/bot/index.ts" || true)
    [ -z "$PIDS" ] && return
  done

  PIDS=$(pgrep -f "src/bot/index.ts" || true)
  if [ -n "$PIDS" ]; then
    echo "強制終了: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
}

stop_bots

if [ "$STOP_ONLY" = true ]; then
  echo "Bot停止完了（再起動なし）"
  exit 0
fi

# 起動
echo "Bot起動: count=$BOT_COUNT server=$SERVER_URL"
cd "$(dirname "$0")/.."
SERVER_URL=$SERVER_URL BOT_COUNT=$BOT_COUNT FAST_FOLD=true \
  nohup npx tsx src/bot/index.ts > ./bot.log 2>&1 &
disown

echo "PID: $!"
echo "ログ: tail -f server/bot.log"
