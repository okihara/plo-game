毎朝の Bot リング戦改善ルーティン。直近24時間の成績を集計し、**集団傾向に基づくピンポイント変更**を 1〜2 箇所だけ加えて PR を作成する。

## 重要な前提（必ず読むこと）

本番の Bot は **全 382 体が以下の 3 種類の personality のいずれか**で動いている。bot 名のハッシュで決定的に割り当てられる（[personalities.ts](../../server/src/shared/logic/ai/personalities.ts) の `getPersonality` と `STRONG_PERSONALITIES`）。

- **TatsuyaN** — バランスやや攻撃的（VPIP 0.30 / PFR 0.22 / threeBet 0.09 / Cbet 0.64）
- **YuHayashi** — バランス TAG（VPIP 0.25 / PFR 0.20 / threeBet 0.09 / Cbet 0.65）
- **yuna0312** — セミ TAG やや受動的（VPIP 0.28 / PFR 0.19 / threeBet 0.06 / Cbet 0.52）

**個別 bot の調整はできない**。調整は次のいずれかとなり、どちらも影響範囲が大きい:

- **A. STRONG_PERSONALITIES の 3 種いずれかの数値変更** — 約 127 体に波及
- **B. preflopStrategy / postflopStrategy / blockerAnalysis 等のロジックを 1〜2 箇所だけ修正** — 全 bot に波及

## 大前提（守ること）

- **1 PR の変更は 1〜2 箇所のみ**。広範囲の修正・リファクタ禁止
- personality の数値変更は **1 パラメータあたり ±10% 以内**
- ロジック変更は既存閾値・条件の小さな調整のみ。新規ファイル・新規関数の追加は禁止
- **PR は人間がマージ**。自分でマージしない
- 変更は **データ駆動**。集計レポートに根拠が無い変更はしない
- DB への書き込みは禁止
- コミットメッセージ・PR は **日本語**
- **直近 3 日以内に同じ箇所（同じ personality / 同じファイル）を触っていたら今日は別の箇所か見送り**（`docs/bot-tuning-log.md` で確認）
- **仮説の根拠が弱いと感じたら見送ってよい**。無理に毎日 PR を作らない

## 手順

### 1. レポート生成

```bash
cd server && npx tsx scripts/bot-daily-report.ts --prod
```

生成: `server/scripts/reports/bot-daily-{YYYY-MM-DD}.md` と `.json`（gitignore 済み）

### 2. 集団分析（個別 bot の話ではない）

JSON を読んで以下を分析する:

- **メトリクス分布**: 全 bot（hands >= 100）の VPIP / PFR / Cbet / AFq / WTSD / WSD / 3Bet の中央値・四分位
- **ベスト 10 vs ワースト 10 のメトリクス差**: 何が違うか（典型的に WSD・WTSD・Cbet の差）
- **ポジション別の集団傾向**: 全 bot 平均で BB / SB / EP がマイナス傾向か等
- **personality 別の平均成績**: 同じ bot 名 → 同じ personality なので、ハッシュで 3 グループに分けて平均を比較できる（必要なら `bot-daily-report.ts` を拡張する）

### 3. 仮説を 1〜2 個立てる

例（あくまで例。実データに即した仮説を立てること）:

- 「ワースト勢で WSD が 40%以下、ベスト勢で 70% → river の弱い手 call が原因。foldToRiverBet を 0.50 → 0.55 に引き上げ（TatsuyaN・YuHayashi 対象）」
- 「3 種中 yuna0312 だけ平均 BB/100 が大きく劣る → cbetFreq 0.52 を 0.55 に微増」
- 「全 bot で BB ポジションの BB/100 がマイナス → postflopStrategy の BB 防衛時の preflop call レンジが広すぎる。該当ロジックを締める」

仮説の根拠が薄ければ「**今日は調整なし**」で終わってよい。データを 1 日溜めて翌日に判断する。

### 4. ユーザーに仮説を提示し、承認を取る

変更を加える**前**に必ず:

- 集団分析の要点（2〜3 行）
- 立てた仮説（1〜2 個）
- 変更しようとしている箇所（ファイル名・パラメータ名・before → after）

をユーザーに見せて、進めてよいか聞く。承認なしに変更しない。

### 5. 変更を適用

承認後、仮説に応じて以下のいずれか:

#### A. `server/src/shared/logic/ai/personalities.ts` の 3 種数値変更

- 対象: `BOT_PERSONALITIES` の `TatsuyaN` / `YuHayashi` / `yuna0312` のいずれか
- 1 パラメータあたり **±10% 以内**
- 1 PR で **1 personality × 最大 2 パラメータ**まで
- 隣接コメントとの整合性を保つ

#### B. ロジックファイルの 1〜2 箇所変更

- 対象例: `preflopStrategy.ts` / `postflopStrategy.ts` / `blockerAnalysis.ts` / `bluffStrategy.ts`
- 既存の閾値や条件を 1〜2 箇所だけ動かす
- **構造変更・新ファイル追加・新関数追加は禁止**
- 影響が全 bot に波及することを認識し、PR 本文で明記

### 6. 調整ログ追記

`docs/bot-tuning-log.md` が無ければ作る。書式:

```markdown
# Bot 調整ログ

## YYYY-MM-DD

### 仮説
（観測 → 推定原因。1〜3 行）

### 観測（集団）
- ベスト 10 平均: WTSD=X%, WSD=Y%, ...
- ワースト 10 平均: WTSD=A%, WSD=B%, ...
- 差は ...

### 変更
- {ファイル名}: {パラメータ/箇所} を {before} → {after}
- 影響範囲: {例: TatsuyaN 系 ~127 体}

### PR
#XXX

### 評価予定
{N 日後} のレポートで {対象指標} の推移を確認。逆に悪化していたら revert。
```

### 7. ブランチ・コミット・push

- ブランチ名: `bot-tuning/YYYY-MM-DD`
- コミットメッセージ（日本語、HEREDOC で）:

```
tune(bot): {要約} を調整

- {変更概要}

集団傾向: {根拠 1 行}
影響範囲: {例: TatsuyaN 系約 127 体 / 全 bot}
```

push 前に `git diff` で意図しない変更が混入していないか必ず目視確認する。

### 8. PR 作成

```bash
gh pr create --base develop --title "Bot 調整 YYYY-MM-DD: {要約}" --body "$(cat <<'EOF'
## 集計サマリ（直近24h）

{レポートの「全体サマリ」を抜粋}

## 集団分析

{ベスト10 vs ワースト10 のメトリクス比較、または personality 別差異}

## 仮説と変更

### 仮説
...

### 変更
- {ファイル: 箇所}: {before} → {after}

### 影響範囲
{例: TatsuyaN 系約 127 体に波及。他 personality には影響なし}

## 評価方法

マージ後 24〜48h でレポートを再生成し、対象指標の変化を確認。逆に悪化していたら revert。

## ロールバック

`git revert <この commit>` で打ち消せる。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

PR のターゲットブランチは原則 `develop`。

### 9. 報告

ユーザーには:
- 集団分析の要点（1〜2 文）
- 仮説と変更内容（before → after）
- PR の URL

を簡潔に報告する。マージは人間判断のため自分でマージしない。

## 補足

- `--hours=48` で期間を伸ばせる: `cd server && npx tsx scripts/bot-daily-report.ts --prod --hours=48`
- 集計のみ走らせて PR を作らない、という運用も可
- 仮説の根拠が薄い日は「今日は調整なし」で終了。データを溜める方が大事
