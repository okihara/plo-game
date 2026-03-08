#!/bin/bash
# Bot再起動スクリプト
# Usage: ./scripts/restart-bots.sh [BOT_COUNT] [SERVER_URL]

BOT_COUNT=${1:-20}
SERVER_URL=${2:-https://baby-plo.up.railway.app}

# 既存のbotプロセスを停止
PIDS=$(pgrep -f "src/bot/index.ts" || true)
if [ -n "$PIDS" ]; then
  echo "既存のbotプロセスを停止: $PIDS"
  kill -9 $PIDS 2>/dev/null
  sleep 1
else
  echo "実行中のbotプロセスなし"
fi

# 起動
echo "Bot起動: count=$BOT_COUNT server=$SERVER_URL"
cd "$(dirname "$0")/.."
SERVER_URL=$SERVER_URL BOT_COUNT=$BOT_COUNT FAST_FOLD=true \
  nohup npx tsx src/bot/index.ts > ./bot.log 2>&1 &
disown

echo "PID: $!"
echo "ログ: tail -f server/bot.log"
