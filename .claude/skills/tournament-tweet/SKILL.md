---
name: tournament-tweet
description: Use this skill when the user wants to generate (and optionally post) a tournament result tweet for the plo-game project. Triggered by `/tournament-tweet` (optionally with a tournamentId). Fetches tournament info, top finishers, and the winner's hands from the production DB, drafts a Japanese result tweet in the BabyPLO style, renders a podium image (top-3 avatars on 1st/2nd/3rd blocks), and—after explicit user confirmation—can post the tweet with the image to the official account via post-tweet.ts.
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

- `tournament.name` / `completedAt` / `totalEntries`（リエントリー込みの総エントリー数）/ `uniqueRegistrations`（実参加者数＝ユニーク登録数）
- `winner.displayName` / `winner.prize`
- `topResults[]` — 上位5名（`position`, `displayName`, `prize`, `reentries`, `avatarUrl`）。**順位の列挙は `prize > 0` の人数まで**（インマネ＝賞金が出た人数。固定の5位ではない）。`avatarUrl` は Step 4 の表彰台画像で使う
- `lastHands[]` — トナメ全体の最後の30ハンド（古い順）。`communityCards`, `potSize`, `winnerNames`, `blinds`, `players[]`（startChips / profit / `finalHand` / 優勝者のホールカードのみ入る）, `actions`
  - `blinds` — `"SB/BB/BBアンティ"` 形式（例 `"0/0/60000"` は BB アンティ＝**実質 BB が 60000**）。`potSize ÷ 実質BB` で **BB 換算**できる
  - `finalHand` — ショーダウン時の役。**ダブルボードのハンドは `"B1: 7フラッシュ / B2: Kストレート"` のように2ボード分が入る**。両ボードを同一プレイヤーが勝つと**スクープ**（`winnerNames` がその1名のみ＝両ボードのポットを総取り）

### Step 2: 優勝者コメントの材料を抜き出す

**初優勝かどうかを必ず確認する:**

```bash
cd server && npx tsx scripts/count-tournament-wins.ts --prod --user <winner.userId>
```

`winCount` が 1（今回のみ）なら**初優勝**としてコメントに織り込む。2 なら「2度目の優勝」のように回数に触れてよい。

`lastHands` から、**優勝者のプレースタイル**を示す具体的な観察を拾う:

- 優勝者が勝ったハンドとその役・ボード・ポット額
- アグレッシブさ（3bet/レイズ頻度）、クローズアップの決め手になったハンド
- スタック推移（startChips の変化）から終盤の勢い
- 接戦か独走か、最後の一撃になったハンド（最終ハンドの profit が極端に大きい側）

観察は**日本語ツイート一文で収まる抽象度**まで言語化する（例: 「要所で勝負を決めた」「拮抗した展開を抜け出した」「大きなポットを確実に拾った」）。

**決め手ハンド（とくに最終ハンド）の具体描写について:**

- 生のカード名（`7♥2♥` 等）や生のチップ数はツイート本文に出さない。
- ただし以下は見せ場として**本文に書いてよい**（むしろ歓迎される）:
  - **役名**: フラッシュ・ストレート・フルハウス等。ダブルボードなら「フラッシュとストレートで両ボード制覇」のように両方の役に触れる。
  - **BB 換算したポット**: 「約17BB のオールインポット」のように、`potSize ÷ 実質BB`（`blinds` から算出）を BB 単位で表現する。
  - **スクープ（ダブルボード両面取り）**: `finalHand` の B1/B2 を両方同一プレイヤーが勝っていれば「スクープ」と明記してよい。**PLO はハイのみなので、シングルボードの1ポット総取りを「スクープ」とは呼ばない**——スクープと書けるのはダブルボードで両ボードを制した場合だけ。
- `finalHand` を必ず確認してから役・スクープを書く。ダブルボード（`B1:.../ B2:...`）かどうかは `finalHand` の有無で判定する。

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

<文脈に合わせた一言>Nエントリー（参加者M名）！
参加者のみなさんありがとうございました🙇‍♂️

#BabyPLO
```

**生成ルール:**

- displayName は JSON から取得した値をそのまま使う（マスクはAPI側で済んでいる前提なので加工しない）
- 順位の列挙は **`prize > 0` の人数まで**（インマネした人数。5位固定ではない。賞金が7名に出たなら7位まで、4名なら4位まで）
- 優勝者コメントは Step 2 の観察を元に、過去サンプルの語彙を活かす:
  - 「勝負どころを逃さないプレーで〜」
  - 「拮抗した状況が続く中、要所でしっかりと勝負を決めて〜」
  - 「ハイレベルなファイナルテーブルを勝ち抜き〜」
- エントリー数は **`Nエントリー（参加者M名）`** の形式で書く（N = `totalEntries`、M = `uniqueRegistrations`）。前置きは曜日・祝日・特記事項があれば織り込む（例: 「休みの中」「本日は」「平日の夜に」）。分からなければシンプルに「本日は」
- **曜日を書く場合は必ず開催日（`completedAt`）から曜日を計算して検証する**。思い込みで書かない（`date -j -f %Y-%m-%d <日付> +%A` 等で確認）
- 絵文字は過去サンプルと同じく 🥇🏆🙇‍♂️ を使用。増やしすぎない
- ハッシュタグは `#BabyPLO` のみ

**出力形式:** 下書きをコードブロックでそのまま提示する。その後に、どの観察を採用したか（1〜2行）を補足し、ユーザーが書き換えやすいよう**別案の優勝者コメント**を2案ほど添える。

### Step 4: 表彰台画像の生成

ツイートに添付する表彰台画像（上位3名のアイコンを 1st/2nd/3rd の台に載せた PNG）を生成する。

```bash
# 引数なしの場合（直近の COMPLETED）
cd server && npx tsx scripts/tournament-tweet-data.ts --prod \
  | python3 scripts/render-podium.py /tmp/tournament-podium.png

# tournamentId 指定
cd server && npx tsx scripts/tournament-tweet-data.ts --prod --tournament <tournamentId> \
  | python3 scripts/render-podium.py /tmp/tournament-podium.png
```

- レンダラーは `server/scripts/render-podium.py`（PIL / cream・forest パレット / 1200×675）。`topResults` の `avatarUrl` を使い、リモートURLはダウンロード、`/images/...` はリポジトリの `public/` から読む。SVG や取得失敗時は人型シルエットにフォールバックする
- 生成後は **Read ツールで PNG を必ず目視確認**する（名前のはみ出し・アイコン欠けがないか）。問題なければ `open /tmp/tournament-podium.png` でユーザーにも見せる
- 画像は Step 5 の投稿に使う（ユーザーが手動添付する場合もこのパスを案内する）

### Step 5: 投稿（画像付き）

下書きを提示したら、**公式アカウントへの公開投稿は取り消せない**ため、必ず一度ユーザーに最終文面の確認を取る。承認を得てから以下を実行する。

1. 確定した本文を **`/tmp/tournament-tweet.txt`** に書き出す（Write ツール）。本文をコマンドラインに載せないため、必ずファイル経由で渡す。画像は Step 4 で生成済みの `/tmp/tournament-podium.png` を使う。
2. まずドライランで内容と文字数を確認する:

   ```bash
   cd server && npx tsx scripts/post-tweet.ts --text-file=/tmp/tournament-tweet.txt --image=/tmp/tournament-podium.png
   ```

3. 問題なければ `--confirm` を付けて実投稿する:

   ```bash
   cd server && npx tsx scripts/post-tweet.ts --text-file=/tmp/tournament-tweet.txt --image=/tmp/tournament-podium.png --confirm
   ```

- 投稿は汎用スクリプト `scripts/post-tweet.ts` を使う。本文は `--text-file`、画像は `--image` のファイルから読み、`server/.env` の `TWITTER_POST_*` で投稿する（本文・接続URL・トークンはコマンドラインに出さない）。
- `--confirm` が無いと投稿せずプレビューのみ（安全側の既定）。
- 投稿後、出力された tweetId と `https://x.com/i/status/<id>` をユーザーに伝える。
- ユーザーが「下書きだけでいい／自分で投稿する」と言った場合は Step 5 をスキップし、画像パス（`/tmp/tournament-podium.png`）の案内だけで完了とする。

### Step 6: 完了

- 下書き・本文ファイル（`/tmp/tournament-tweet.txt`）は一時ファイルなので保存管理は不要
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
