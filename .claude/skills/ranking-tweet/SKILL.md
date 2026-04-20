---
name: ranking-tweet
description: Use this skill when the user wants to generate a RP ranking update tweet for the plo-game project (BabyPLO). Triggered by `/ranking-tweet`. Runs the rank-points-ranking script with `--diff` to compare the latest completed tournament against the previous standings, then drafts a Japanese tweet highlighting position movements in the BabyPLO style for the user to tweak by hand.
---

# Ranking Tweet

plo-game の RP ランキング変動ツイート下書きを作るスキル。**直近の完了トナメ前後**の順位を比較し、大きく動いたプレイヤーや新規ランクインを日本語ツイートにまとめる。

## 入力

- 引数なし → 直近で `COMPLETED` になったトナメ前後の差分を対象にする
- 引数は今のところ取らない（欲しくなったら `--tournament` 指定を足す）

## Workflow

### Step 1: データ取得

プロジェクトルートから以下を実行する。**接続URLは手で書かない。** スクリプトは `server/.env` の `DATABASE_PROD_PUBLIC_URL` を自動で読む。

```bash
cd server && npx tsx scripts/rank-points-ranking.ts --prod --diff
```

stdout に JSON が出る（`--diff` モードでは `dotenv` のログは抑制済み）。主要フィールド:

- `latestTournament.name` / `completedAt` / `entries` — 差分のベースになった最新トナメ
- `totals.currentRankedUsers` / `previousRankedUsers` — ランキング人数の変化
- `top[]` — 最新ランキングの TOP N（既定 30）。各要素:
  - `position`, `name`, `totalRp`, `rpGained` (前回からの差)
  - `previousPosition` (`null` なら前回圏外), `positionDelta` (正でランクアップ)
  - `isNewToTop` — TOP N に**今回**入った人を示す
- `participants[]` — 最新トナメに**参加した人**の変動（RP 獲得降順）。RP 獲得 0 の人も含む。

### Step 2: 見どころを抽出

`participants` と `top` から、ツイートで強調すべき動きを拾う:

- **新 TOP 10 ランクイン**: `top` で `position <= 10` かつ `isNewToTop === true` の人
- **大ジャンプ**: `participants` で `positionDelta >= 5` の人（TOP 圏内に近いほど印象が強い）
- **上位の躍進**: `top[0..2]` で `positionDelta > 0` のランクアップ（※ランクダウン側は取り上げない）
- **連覇・キープ**: `top[0]` の `positionDelta === 0` で、かつ `rpGained > 0`（＝1位が今日も勝って優勝確定感）
- **ランキング人数の増加**: `currentRankedUsers - previousRankedUsers` が 1 以上なら **デビュー勢**が出た

見どころは**1〜2 個に絞る**のが読みやすい。全員のΔ表を並べるのは避ける。

### Step 3: ツイート下書き生成

**フォーマット骨格（案）:**

```
【RPランキング更新】<トナメ名>終了後

🏆 1位 <name1>（<totalRp> / <マーカー>）
  2位 <name2>（<totalRp> / <マーカー>）
  3位 <name3>（<totalRp> / <マーカー>）

今回の目玉:
<1〜2 行のコメント>

#BabyPLO
```

マーカーは以下の凡例を使う（本文に説明は入れない、直感で伝わる範囲で）:

- `↑N` — N ランクアップ
- `--` — 同順位キープ
- `NEW` — 前回圏外から TOP N に入った

**ネガティブ表記は出さない。** 順位ダウン（`↓N`）は**表記しない**。ランクダウンしたプレイヤーは順位・名前・RP のみ載せ、マーカーは省略する。「今回の目玉」にもランクダウンや脱落は選ばない（上昇・キープ・新規ランクイン・大幅RP獲得のみを取り上げる）。BabyPLO のツイートはお祝いトーンで統一する。

**生成ルール:**

- 対象の TOP は基本 3 位まで。4〜5 位に劇的な動きがあれば 5 位まで伸ばす
- 「今回の目玉」は最も絵になる動きを 1 本だけ選ぶ。例:
  - 「ふちがち さんが 23位 → 9位 に急浮上して一気に TOP 10 入り」
  - 「IOwOI9 さんが 3位 → 2位 に上昇、トップ争いが一段加速」
  - 「1位のゆたちん さんは今日も勝ってリードを広げる展開」
- 絵文字は 🏆 を 1 位に 1 個だけ。ダラダラ付けない
- ハッシュタグは `#BabyPLO` のみ
- `name` はマスク済みの前提なので加工しない

**出力形式:** 下書きをコードブロックでそのまま提示する。その後に、採用した観察（どの動きを目玉にしたか）を 1〜2 行で補足し、**別案の目玉コメント**を 2 案ほど添える。

### Step 4: 完了

- ファイル保存はしない
- メモリ保存も不要（毎回異なる内容）
- RP 計算ルールはまだ **設計中** である点に触れない方が無難。ルールが確定するまでは「暫定ランキング」「試算」のニュアンスを含めておくと安全

## 参考: 望ましい出力例（架空）

```
【RPランキング更新】BabyPLO Holiday 4/19 終了後

🏆 1位 ゆたちん（766 / --）
  2位 IOwOI9（703 / ↑1）
  3位 da*****a（698 / ↓1）

今回の目玉:
ふちがち さんが 23位 → 9位 に急浮上、ノーリエントリー優勝で一気に TOP 10 入り🔥

#BabyPLO
```

この下書きをベースに、ユーザーが手直しして使う想定。
