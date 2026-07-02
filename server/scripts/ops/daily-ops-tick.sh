#!/bin/bash
# daily-ops-tick の cron ラッパー。
#   crontab 例（5分毎、JST 11:00〜01:55）:
#     */5 11-23 * * * /Users/masa/work/plo-game/server/scripts/ops/daily-ops-tick.sh
#     */5 0-1  * * * /Users/masa/work/plo-game/server/scripts/ops/daily-ops-tick.sh
#
# - PATH を明示（cron 環境には homebrew の node/python3 が無い）
# - server/ に cd してから node_modules/.bin/tsx を直接叩く（npx 不使用）
# - mkdir ロックで二重起動防止（macOS に flock が無いため。stale 15分で奪取）
# - ログは ~/Library/Logs/plo-ops/tick-YYYYMMDD.log、30日でローテ
# - 異常終了時は osascript で通知（ステップ単位の通知は ts 側でも出す）
set -uo pipefail
export TZ=Asia/Tokyo
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SERVER_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$HOME/Library/Logs/plo-ops"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/tick-$(date +%Y%m%d).log"
LOCK_DIR="$LOG_DIR/tick.lock"

# --- 二重起動防止（stale ロックは15分で奪取） ---
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

cd "$SERVER_DIR" || exit 1

if ! ./node_modules/.bin/tsx scripts/ops/daily-ops-tick.ts --prod "$@" >> "$LOG_FILE" 2>&1; then
  osascript -e 'display notification "daily-ops-tick が異常終了しました。ログを確認してください" with title "BabyPLO Ops"' 2>/dev/null || true
fi

# --- 30日より古いログを削除 ---
find "$LOG_DIR" -name 'tick-*.log' -mtime +30 -delete 2>/dev/null || true
find "$LOG_DIR" -name 'notified-*.json' -mtime +7 -delete 2>/dev/null || true
