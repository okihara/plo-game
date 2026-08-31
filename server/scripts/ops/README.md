# daily-ops: 毎日のトナメ運用

毎日の運用（トナメ作成・各種Xポスト）は **Claude Code の scheduled task 3本**で回している。
以前のローカル Mac の cron による自動運用（`daily-ops-tick.sh` を5分毎に実行）は **廃止した**。

## 現在の運用（JST）

| 時刻 | scheduled task | 中身 |
| --- | --- | --- |
| 12:05 | `0` | 今日のトナメを本番 API で作成 → `/tournament-announce` で告知ツイートを生成・投稿 |
| 23:50 | `tournament-tweet` | `/tournament-tweet` で結果ツイート（表彰台画像付き）を生成・投稿 |
| 09:06 | `ranking-tweet` | `/ranking-tweet` で RP ランキング差分ツイート（TOP30 画像付き）を生成・投稿 |

タスク定義は `~/.claude/scheduled-tasks/<id>/SKILL.md`、文面の生成ルールは `.claude/skills/` 配下の各スキル。
投稿はどれも `server/scripts/post-tweet.ts` を通る。

**cron 時代にあって今はやっていないもの**: メモリ存在ウォッチドッグ、開始告知（22:00）、
エントリー数の途中経過（22:15〜）。必要になったら下の tick を手動で回すか、scheduled task を足す。

## トナメ作成に使うコマンド

`daily-ops-tick.ts` は cron 用ディスパッチャとして作ったものだが、**冪等**なのでステップを絞って
scheduled task / 手動から呼ぶ形で使い続けている。

```bash
cd server
npx tsx scripts/ops/daily-ops-tick.ts --prod --dry-run       # 今日のトナメの有無を確認（読み取りのみ）
npx tsx scripts/ops/daily-ops-tick.ts --prod --only=create   # 未作成なら作成（作成済みなら何もしない）
```

曜日ごとのバリアント・トナメ名・設定値は `src/modules/tournament/weeklySchedule.ts` が単一の真実の源泉。
作成後はサーバーのアクティブ一覧に載ったかまで確認する（載っていなければエラーになる）。

`announce` / `start` / `progress` / `result` / `ranking` ステップは **スキル側へ移行済みで使っていない**
（tick 内の LLM 生成と `TweetDraft` 経由の投稿は残っているが休眠状態）。二重投稿になるので、
scheduled task と併用して `--only` なしで tick を回さないこと。

## セットアップ（server/.env）

```
PROD_API_BASE_URL=https://baby-plo.app
PROD_ADMIN_SECRET=<Railway の ADMIN_SECRET と同じ値>
```

既存の `DATABASE_PROD_PUBLIC_URL` / `TWITTER_POST_*` も使う。
**Railway 側で `ADMIN_SECRET` が未設定だと admin ルートが素通しになる**ので、未設定なら先に Railway で設定すること。
`ANTHROPIC_API_KEY` は休眠中の tick 側 LLM 生成にしか使わない（スキル経由の生成には不要）。

### Railway 側の前提

- **11:00〜24:00 JST はなるべくデプロイしない**（メモリ上の WAITING トナメが消える。消えたら Admin から作り直す）
- サーバー側にツイート関連の環境変数（`ANTHROPIC_API_KEY` / `TWITTER_POST_*` 等）は不要

## 検証

```bash
cd server
npx tsx scripts/ops/daily-ops-tick.ts --local --dry-run --now=2026-07-02T18:05:00+09:00  # ローカルDB + 時計偽装
npx tsx scripts/ops/daily-ops-tick.ts --prod --dry-run                                   # 本番に対して読み取りのみ
```

## 失敗時の運用

- トナメが作成できていない / サーバーメモリから消えた → `/admin/tournaments` から手動で作り直す
- ツイートの投稿失敗は **自動再投稿しない**（二重投稿防止）。X を確認して手動で対応する
- scheduled task は二重発火することがある。投稿前に過去セッションの投稿記録（tweetId）を確認する

## 廃止済み

- **ローカル cron 運用**と、そのラッパー `daily-ops-tick.sh`（起動ロック・ログローテ・macOS 通知）。
  現在どこからも呼ばれていない
- サーバー側の tweet scheduler と `/admin/tweets` 画面（cron 移行時に廃止）
