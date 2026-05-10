---
name: tournament-tweet
description: Use this skill when the user wants to generate a tournament result tweet for the plo-game project. Triggered by `/tournament-tweet` (optionally with a tournamentId). Fetches tournament info, top finishers, and the winner's hands from the production DB, then drafts a Japanese result tweet in the BabyPLO style for the user to tweak by hand.
---

# Tournament Tweet

plo-game のトーナメント結果ツイート下書きを作るスキル。本番DBから対象トナメの順位・参加人数・直近ハンドを取得し、過去ツイートの文体に合わせて日本語の下書きを生成する。

## 入力

- 引数なし → 直近で `COMPLETED` になったトナメを対象
- 引数あり → `tournamentId` を指定して対象を固定

## Workflow

### Step 1: データ取得

プロジェクトルート（`/Users/masa/work/plo-game`）から以下を実行する。**接続URLをコマンドラインに載せない。** スクリプトは `server/.env` の `DATABASE_PROD_PUBLIC_URL` を自動で読む。

```bash
# 引数なしの場合（直近の COMPLETED）
cd server && npx tsx scripts/tournament-tweet-data.ts --prod

# tournamentId 指定
cd server && npx tsx scripts/tournament-tweet-data.ts --prod --tournament <tournamentId>
```

stdout に JSON が出る。主要フィールド:

- `tournament.name` / `completedAt` / `totalEntries`（リエントリー込みの総エントリー数）
- `winner.displayName` / `winner.prize`
- `topResults[]` — 上位5名（`position`, `displayName`, `prize`, `reentries`）
- `lastHands[]` — トナメ全体の最後の30ハンド（古い順）。`communityCards`, `potSize`, `winnerNames`, `players[]`（startChips / profit / 優勝者のホールカードのみ入る）, `actions`

### Step 2: 優勝者コメントの材料を抜き出す

`lastHands` から、**優勝者のプレースタイル**を示す具体的な観察を拾う:

- 優勝者が勝ったハンドとその役・ボード・ポット額
- アグレッシブさ（3bet/レイズ頻度）、クローズアップの決め手になったハンド
- スタック推移（startChips の変化）から終盤の勢い
- 接戦か独走か、最後の一撃になったハンド（最終ハンドの profit が極端に大きい側）

観察は**日本語ツイート一文で収まる抽象度**まで言語化する（例: 「要所で勝負を決めた」「拮抗した展開を抜け出した」「大きなポットを確実に拾った」）。具体的なカード名や数値はツイート本文には出さないのが既存フォーマット。

**ネガティブな話題は書かない:**

- リエントリー回数には**触れない**（「一度バストして〜」「リエントリーから〜」も NG）。優勝コメントは前向きなプレー観察だけで構成する。
- 他プレイヤーの失敗（大ミス、痛い負け方）にも触れない。
- `winner.reentries` や `topResults[].reentries` はあくまで内部の補助情報として扱い、ツイート本文に表現しない。

### Step 3: ツイート下書き生成

過去サンプル3本の文体を踏襲して生成する。

**フォーマット骨格:**

```
【<トナメ名>】

1位　<displayName> さん
2位　<displayName> さん
3位　<displayName> さん
4位　<displayName> さん
5位　<displayName> さん

🥇<優勝者displayName> さん
<優勝者のプレーに触れた1〜2文のコメント>🏆
おめでとうございます！

<文脈に合わせた一言>N エントリー！
参加者のみなさんありがとうございました🙇‍♂️

#BabyPLO
```

**生成ルール:**

- displayName は JSON から取得した値をそのまま使う（マスクはAPI側で済んでいる前提なので加工しない）
- 上位の人数は `topResults` の件数に合わせる（4名しかいなければ4位まで）
- 優勝者コメントは Step 2 の観察を元に、過去サンプルの語彙を活かす:
  - 「勝負どころを逃さないプレーで〜」
  - 「拮抗した状況が続く中、要所でしっかりと勝負を決めて〜」
  - 「ハイレベルなファイナルテーブルを勝ち抜き〜」
- エントリー数の前置きは曜日・祝日・特記事項があれば織り込む（例: 「休みの中」「本日は」「平日の夜に」）。分からなければシンプルに「本日は」
- 絵文字は過去サンプルと同じく 🥇🏆🙇‍♂️ を使用。増やしすぎない
- ハッシュタグは `#BabyPLO` のみ

**出力形式:** 下書きをコードブロックでそのまま提示する。その後に、どの観察を採用したか（1〜2行）を補足し、ユーザーが書き換えやすいよう**別案の優勝者コメント**を2案ほど添える。

### Step 4: 完了

- ファイル保存はしない（ユーザーが手直しして使う想定）
- メモリ保存も不要（毎回異なる内容なので）

## 参考: 過去ツイートサンプル

優勝者コメントの語彙とトーンの参考に。

```
【BabyPLO Blue Monday 4/12】

1位　ゆたちん さん
2位　tsufaana さん
3位　yu**********k さん
4位　かずハイボール さん
5位　IOwOI9 さん

🥇ゆたちん さん
2度目の優勝、本当にお見事でした🏆
勝負どころを逃さないプレーで、堂々のトップフィニッシュです！
おめでとうございます！

本日は37エントリー！
参加者のみなさんありがとうございました🙇‍♂️

#BabyPLO
```

```
【BabyPLO Holiday 4/11】

1位　ikeda さん
...（略）...
🥇ikeda さん
拮抗した状況が続く中、要所でしっかりと勝負を決めて優勝されました🏆
おめでとうございます！

休みの中33エントリー！
参加者のみなさんありがとうございました🙇‍♂️

#BabyPLO
```

```
【BabyPLO Daily Happy Friday 4/10】

... 4位まで ...
🥇ゆたちん さん
FT常連の方、リング週間チャンピオンや全期間1位の方々、そして新規プレイヤーの方まで集まるハイレベルなファイナルテーブルを勝ち抜き、見事優勝されました🏆
おめでとうございます！

参加者のみなさんありがとうございました🙇‍♂️
（今日はリエントリー少なく4位からインマネです）
#BabyPLO
```
