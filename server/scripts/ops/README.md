# daily-ops: 毎日のトナメ運用自動化

ローカル Mac の cron から5分毎に `daily-ops-tick.ts` を実行し、以下を完全自動化する。

| 時間帯 (JST) | ステップ | 内容 |
| --- | --- | --- |
| 11:00–21:30 | `create` | 曜日コンフィグ表（`src/modules/tournament/weeklySchedule.ts`）に従い 22:00 開始のトナメを本番 API で作成 |
| 作成後–22:00 | `watchdog` | 再デプロイ等でサーバーメモリからトナメが消えていないか監視（消えていたら通知） |
| 18:00–21:30 | `announce` | 告知文をローカルで LLM 生成して直接投稿。19:00 までに生成できなければ定型文フォールバック |
| 22:00–22:45 | `start` | 「スタートしました＋レイトレジ締切」定型文を直接投稿 |
| 22:15–22:38 | `progress` | 「現在Nエントリー＋締切」定型文を直接投稿（エントリー2未満はスキップ） |
| 終了検知後 | `result` | 結果文をローカルで LLM 生成して直接投稿（生成失敗は次 tick で再試行、3回で通知） |
| 結果投稿後 | `ranking` | RPランキング差分＋シーズン進捗の定型文を、TOP30 画像付きで直接投稿 |

ツイートの生成（LLM）・投稿はすべてこのスクリプトがローカルで行う。サーバー側の
tweet scheduler と `/admin/tweets` 画面は廃止済みで、サーバー API はトナメの作成・
一覧（`/api/tournaments`）にしか使わない。

冪等性は `TweetDraft` の `@@unique([kind, tournamentId])` が最終ガード。
どの tick で何度実行しても二重投稿しない（mkdir ロック / create(POSTING) claim / unique 制約の三重防護）。

## セットアップ

### 1. server/.env にキーを追加

```
PROD_API_BASE_URL=https://baby-plo.app
PROD_ADMIN_SECRET=<Railway の ADMIN_SECRET と同じ値>
ANTHROPIC_API_KEY=<告知・結果ツイートの LLM 生成に使う>
```

既存の `DATABASE_PROD_PUBLIC_URL` / `TWITTER_POST_*` も使う（設定済みのはず）。
`ANTHROPIC_MODEL` で生成モデルを上書きできる（省略時は既定値）。
**Railway 側で `ADMIN_SECRET` が未設定だと admin ルートが素通しになる**ので、未設定なら先に Railway で設定すること。

### 2. Railway 側の前提

- **11:00〜24:00 JST はなるべくデプロイしない**（メモリ上の WAITING トナメが消える。消えたら watchdog が通知するので Admin から作り直す）
- サーバー側にツイート関連の環境変数（`ANTHROPIC_API_KEY` / `TWITTER_POST_*` 等）は不要

### 3. crontab

```cron
*/5 11-23 * * * /Users/masa/work/plo-game/server/scripts/ops/daily-ops-tick.sh
*/5 0-1  * * * /Users/masa/work/plo-game/server/scripts/ops/daily-ops-tick.sh
```

ログ: `~/Library/Logs/plo-ops/tick-YYYYMMDD.log`（30日ローテ）。失敗時は macOS 通知。

### 4. Mac のスリープ対策

cron はスリープ中実行されない（起床後の追い掛けも無い）。いずれかを推奨:

- AC 電源運用: `sudo pmset -c sleep 0 displaysleep 10`
- 毎日決まった時刻に起床: `sudo pmset repeat wakeorpoweron MTWRFSU 10:55:00`

## 段階的有効化

wrapper は引数をそのまま tick に渡すので、crontab 側で絞れる:

```cron
# Day1-2: 全ステップ dry-run（ログの判断だけ確認）
*/5 11-23 * * * .../daily-ops-tick.sh --dry-run
# Day3: 作成のみ実運用
*/5 11-23 * * * .../daily-ops-tick.sh --only=create
# Day4: 告知・開始・進行まで
*/5 11-23 * * * .../daily-ops-tick.sh --only=create,watchdog,announce,start,progress
# Day5〜: 全ステップ（フラグなし）
```

`ranking` はシーズンの完了トナメが2本以上になってから有効化する（2本未満は自動でスキップされる）。

## 手動実行・検証

```bash
cd server
# ローカルで時計を偽装して dry-run
npx tsx scripts/ops/daily-ops-tick.ts --local --dry-run --now=2026-07-02T18:05:00+09:00
# 本番に対して dry-run（読み取りのみ、投稿・作成はしない）
npx tsx scripts/ops/daily-ops-tick.ts --prod --dry-run
```

## 失敗時の運用

- ステップ失敗・フォールバック発動・画像生成失敗などは macOS 通知（同一事象は1営業日1回）
- `FAILED` になったツイートは**自動再投稿しない**（二重投稿防止）。X を確認のうえ手動対応
  （必要なら `TweetDraft` の該当行を確認: `npx tsx` ワンライナー or DB クライアント）
- LLM 生成の失敗は `FAILED` にはならず、announce は次 tick 再試行（19時以降は定型文へ）、
  result は最大3回再試行してから通知する
