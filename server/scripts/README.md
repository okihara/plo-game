# Scripts

運用・デバッグ用スクリプト集。TypeScript スクリプトは `cd server && npx tsx scripts/<name>.ts` で実行。

## 共通オプション


| フラグ       | 説明                                         |
| --------- | ------------------------------------------ |
| `--prod`  | 本番DB接続（`DATABASE_PROD_PUBLIC_URL` 環境変数が必要） |
| `--apply` | 実際にDB変更を適用（省略時はプレビューのみ）                    |


---

## バッジ


| スクリプト                    | 説明                                          |
| ------------------------ | ------------------------------------------- |
| `award-all-badges.ts`    | 全ユーザーにバッジを一括判定・付与（ハンド数バッジ、ランキング1位バッジ）       |
| `award-first-penguin.ts` | 2026/3/1以前にプレイした全ユーザーに first_penguin バッジを付与 |
| `list-ranking-badges.ts` | ランキングバッジ保持者一覧を表示                            |


## Bot管理


| スクリプト                       | 説明                                           |
| --------------------------- | -------------------------------------------- |
| `bot-anon-ratio.ts`         | Bot全体の anonymous アイコン比率を表示                   |
| `bot-displayname-check.ts`  | Bot の displayName 設定状況を確認                    |
| `bot-hands-stats.ts`        | Bot のハンド数分布を表示                               |
| `bot-icon-rebalance.ts`     | Bot アイコンをリバランス（20% anonymous、80% プリセット70種均等） |
| `bot-icon-spread.ts`        | Bot アイコン使用状況を表示、未使用アイコンへの再割り当てSQL生成          |
| `bot-set-displaynames.ts`   | displayName なし Bot の約70%に displayName を設定    |
| `bot-set-displaynames-2.ts` | displayName なし Bot への追加設定（61%→80%）           |
| `fix-anonymous-bots.ts`     | avatarUrl=null の Bot に anonymous.svg を設定     |
| `set-anonymous-batch.ts`    | 指定 Bot の7割を anonymous アイコンに変更                |
| `icon-usage.ts`             | アイコン使用状況を表示                                  |
| `retire-bots.ts`            | 5000ハンド以上の Bot を特定し入れ替えリストを生成                |


## ハンド分析・シミュレーション


| スクリプト                             | 説明                                                                 |
| --------------------------------- | ------------------------------------------------------------------ |
| `query-hand.ts`                   | ハンド履歴を取得して表示。引数: `<handId>`                                        |
| `find-bad-beats.ts`               | 過去のハンド履歴からバッドビートを検索。`--limit` で検索数指定（デフォルト10000）                   |
| `replay-hand-g5kmub.ts`           | Hand #1394 を再現し、特定プレイヤーのリバー判断を検証                                   |
| `replay-situation.ts`             | 特定シチュエーションを繰り返しシミュレートし getPostflopDecision の挙動を確認                  |
| `postflop-simulation.ts`          | ランダムなシチュエーションで getPostflopDecision をシミュレーション。引数: `[回数]`（デフォルト5000） |
| `postflop-flush-onepair-debug.ts` | フラッシュ可能ボードでワンペアがコールするケースを調査                                        |
| `postflop-nutrank1-debug.ts`      | ナッツでフォールドしてしまうケースを調査                                               |


## トーナメント


| スクリプト                        | 説明                                               |
| ---------------------------- | ------------------------------------------------ |
| `rank-points-ranking.ts`     | RP（ランクポイント）の通算ランキングを集計。順位×エントリー数でRP付与、Bot除外     |
| `render-rp-ranking.py`       | `rank-points-ranking.ts --tsv` の出力を PNG 画像に整形    |

### RPランキングの出し方

```bash
# テキスト表示（デフォルト TOP 30）
cd server && npx tsx scripts/rank-points-ranking.ts --prod

# 件数指定
cd server && npx tsx scripts/rank-points-ranking.ts --prod --top=50

# 画像として出力（SNS投稿用）
cd server && npx tsx scripts/rank-points-ranking.ts --prod --image=/tmp/rp-ranking.png

# TSV のみ出力（画像化の中間形式・確認用）
cd server && npx tsx scripts/rank-points-ranking.ts --prod --tsv
```

付与ルール:

- 対象: `status=COMPLETED` のトナメ（`TournamentResult` が2件以上）
- エントリー数 N = 結果行数（Bot含む、リエントリーは最終順位のみ）
- 付与人数: N≤6→3 / ≤18→6 / ≤27→9 / ≤54→15 / ≤100→25 / ≤200→40 / それ以上→`ceil(N*0.20)`
- RP = `round(100 × 0.05^((pos-1)/(pc-1)) × √(N/9))`、1位のみ ×1.3 ボーナス
- Bot（`User.provider='bot'`）はランキングから除外
- 名前は `displayName` を優先、未設定かつ `nameMasked=true` なら `maskName()` で伏字化


## インフラ・ユーティリティ


| スクリプト                    | 説明                                              |
| ------------------------ | ----------------------------------------------- |
| `restart-bots.sh`        | Bot プロセスの停止・再起動。引数: `[BOT_COUNT] [SERVER_URL]`  |
| `process-badge-image.py` | バッジ元画像を 256x256 / 512x512 に加工。引数: `<元画像> <出力名>` |


