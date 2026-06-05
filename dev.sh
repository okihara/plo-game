#!/usr/bin/env bash
#
# tmux で開発環境を一発起動するスクリプト。
#   ┌────────────┬────────────┐
#   │ 左上: バックエンド │            │
#   ├────────────┤ 右: bot 起動用 │
#   │ 左下: フロント   │  (空)      │
#   └────────────┴────────────┘
# PostgreSQL は docker-compose で起動する（既に起動済みなら何もしない）。
#
# 使い方:
#   ./dev.sh          # セッション作成 & アタッチ
#   ./dev.sh stop     # セッション終了
#
set -euo pipefail

SESSION="plo"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# stop サブコマンド
if [[ "${1:-}" == "stop" ]]; then
  tmux kill-session -t "$SESSION" 2>/dev/null && echo "セッション '$SESSION' を終了しました" || echo "セッション '$SESSION' は起動していません"
  exit 0
fi

# 既に起動済みならアタッチするだけ
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "セッション '$SESSION' は既に起動済みです。アタッチします。"
  exec tmux attach -t "$SESSION"
fi

# PostgreSQL 起動（docker-compose）
echo "PostgreSQL を起動中..."
( cd "$ROOT" && docker-compose up -d )

# tmux セッション作成（最初のペイン = 左）
tmux new-session -d -s "$SESSION" -c "$ROOT" -n dev
LEFT=$(tmux display-message -p -t "$SESSION:dev" '#{pane_id}')

# 左ペインを左右分割 → 右ペイン（bot 起動用・空）を作成
RIGHT=$(tmux split-window -h -P -F '#{pane_id}' -t "$LEFT" -c "$ROOT")

# 左ペインを上下分割 → 下ペイン（フロント）を作成。LEFT が上ペインになる
BOTTOM=$(tmux split-window -v -P -F '#{pane_id}' -t "$LEFT" -c "$ROOT")

# 左上: バックエンド
tmux send-keys -t "$LEFT" 'npm run dev:server' C-m

# 左下: フロント
tmux send-keys -t "$BOTTOM" 'npm run dev' C-m

# 右ペイン（bot 用）にフォーカスを置いて待機
tmux select-pane -t "$RIGHT"

echo "起動完了: フロント=http://localhost:5173 / サーバー=http://localhost:3001"
exec tmux attach -t "$SESSION"
