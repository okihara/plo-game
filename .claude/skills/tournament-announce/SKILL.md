---
name: tournament-announce
description: Use this skill when the user wants to draft a daily tournament announcement tweet for the plo-game project (BabyPLO). Triggered by `/tournament-announce` (optionally with date or freeform notes like 曜日・特典・新機能). Generates Japanese promotion tweets in the existing BabyPLO announcement style, and—after the user picks a draft and asks to post—can post it with the variant-specific announce image to the official account via post-tweet.ts.
---

# Tournament Announce

plo-game（BabyPLO）の毎日トナメ **開催告知** ツイート下書きを作るスキル。結果ツイート（`/tournament-tweet`）と対になる、開催前の宣伝用。

## 運用コンテキスト

毎日 **12:05 JST の scheduled task（`~/.claude/scheduled-tasks/0/`）** から呼ばれる。ローカル cron による
自動運用（`server/scripts/ops/daily-ops-tick.sh`）は廃止済みで、告知の生成・投稿はこのスキルが唯一の経路。

そのため:

- **人がいない前提で動く**（Step 4 参照）。自動実行では確認を挟まず自分で1案を選んで投稿まで進める
- 告知の前に **今日のトナメが本番に登録済みか**を必ず確認する（Step 1.2）
- 投稿前に **今日分が既に投稿されていないか**を確認する（Step 5）。scheduled task は二重発火することがある

## 入力

- 引数なし → 今日の日付で標準的な告知を生成
- 引数あり → 日付・曜日・特記事項（新機能、プレゼント企画、祝日など）をフリーテキストで受け取る
  - 例: `/tournament-announce 金曜はAmazonギフト券1000円`
  - 例: `/tournament-announce 4/20 月曜 AIレビュー機能リリース直後`

## 固定情報

- **トナメ名プレフィックス**: `BabyPLO Daily M/D`（曜日物・祝日はユーザー指示に従って `Holiday` `Blue Monday` `Happy Friday` などに置換）
- **開始時刻**: 22:00（固定）
- **URL**: `https://baby-plo.app`
- **ハッシュタグ**: `#BabyPLO`
- **参加費**: 無料（フリーロール）

日付が未指定なら「今日」「今夜」を優先し、必要な箇所だけ `M/D` を埋める。

### 曜日別バリアント（週次スケジュール）

今夜のトナメ種別は曜日で決まる。告知文に **「今夜は <variant>」** という形で必ず織り込む（3案どれでも自然な位置に1回）。

| 曜日 | バリアント |
|---|---|
| 月曜 | PLO |
| 火曜 | PLO |
| 水曜 | PLO8（Hi-Lo） |
| 木曜 | PLO |
| 金曜 | PLO（優勝者にAmazonギフト券1,000円分） |
| 土曜 | 5-Card PLO |
| 日曜 | PLO Double Boards Bomb Pot |

- 通常PLO日（月・火・木）はバリアントに特別に触れなくてもOK（触れる場合は「通常のPLO」程度）
- 水曜の `PLO8`、土曜の `5-Card`、日曜の `Double Boards Bomb Pot` は**必ず明記**（普段と違うバリアントなので集客の核）
- 金曜は **Amazonギフト券特典**を必ず本文に入れる（バリアントは通常PLO）

### シーズン（RPランキング）

毎日のトナメは進行中シーズンの RP ランキングに積み上がる。**告知には毎回シーズンに触れる**（今夜の1戦がシーズンの中でどういう意味を持つかを示すのが狙い）。

**単一の真実の源泉**: `server/src/modules/season/seasonConfig.ts` の `CURRENT_SEASON`（`name` / `label` / `start` / `end`）。日付や名称を記憶や過去ツイートから書かない。

事実関係（誤記すると訂正が効かないので厳守）:

- RP は **入賞（上位15%ペイアウト）した場合のみ**付く。再算定後の賞金 ÷ 1000 の切り上げ。「参加するだけでRPが貯まる」は**誤り**
- 集計対象はシーズン期間内に完了したトナメ。Bot はランキングから除外（エントリー数には含む）
- 進行中シーズンの順位を見る導線は **アプリ内の「ランキング」タブ**。`/season` は確定済みシーズンの結果発表ページなので、開催中シーズンの誘導先にしない
- 告知に載せる URL は `https://baby-plo.app` の1本だけ（既存ルール）。シーズン用の別URLは足さない

**触れ方は残り日数で強度を変える**（JST基準、`CURRENT_SEASON.end` から算出）:

| 残り | 触れ方 |
|---|---|
| 8日以上 | 軽く1行。「勝てばシーズン◯のRPが積める」程度に留め、締切は書かない |
| 7日以内 | 締切を明示。「シーズン◯は M/D まで、残りN回」のように具体化して煽る |
| 最終日 | 「シーズン最終戦」として前面に出す |
| シーズン開始から3日以内 | 「新シーズンが始まったばかり＝今からでも巻き返せる」の切り口 |

**`end` が暫定値のときは締切を書かない**: `seasonConfig.ts` の `end` に「未定」「暫定」等のコメントが付いている場合、その日付は運用上の仮置きなので、日付・残り日数には一切触れず「シーズン◯開催中」レベルに留める。

## Workflow

### Step 1: 文脈整理

ユーザー入力から以下を抽出する（なければ省略）:

- 日付 / 曜日 / 祝日
- 特典・キャンペーン（例: 金曜の Amazon ギフト券）
- 新機能・直近のアップデート（例: AIレビュー）
- 気分・トーン寄せ（例: 月曜の憂鬱、連休中、平日夜）

### Step 1.2: 今日のトナメの存在確認（必須）

未登録のトナメを告知しないため、先に本番の状態を見る。

```bash
cd server && npx tsx scripts/ops/daily-ops-tick.ts --prod --dry-run       # 読み取りのみ。今日のトナメの有無を表示
```

`tournament=none` なら作成する（冪等なので作成済みなら何もしない）:

```bash
cd server && npx tsx scripts/ops/daily-ops-tick.ts --prod --only=create
```

曜日ごとのバリアント・トナメ名・設定値は `server/src/modules/tournament/weeklySchedule.ts` が単一の真実の源泉。
下の「曜日別バリアント」表と食い違ったら **weeklySchedule.ts を正とする**。

### Step 1.5: シーズン文脈の取得（必須）

1. `server/src/modules/season/seasonConfig.ts` を Read し、`CURRENT_SEASON` の `name` / `label` / `end` と、`end` に暫定コメントが付いていないかを確認する
2. 告知日（JST）から `end` までの残り日数を計算し、「シーズン（RPランキング）」の表でどの強度で触れるかを決める
3. **残り7日以内・最終日のときだけ**、順位状況を取りにいく:

```bash
cd server && npx tsx scripts/rank-points-ranking.ts --prod
```

首位の名前・RP差など、煽りに使える具体値を1つだけ拾う（TOP3を羅列しない。告知は結果ツイートではない）。残り8日以上の日はこのスクリプトを**実行しない**（重いうえ、日々の告知に細かい順位は不要）。

### Step 2: ツイート下書きを **3案** 生成

3案それぞれ **別のトーン・切り口** で書く（例: メリット訴求 / ノリ・感情 / 特典押し / 季節ネタ / あるあるネタ など、切り口自体も毎回自由に選んでよい）。

**【冒頭2行は全案共通・必須】**

```
参加無料のオンラインPLOトーナメント
今夜も22:00から開催です！
```

3案すべてこの2行で始める。改変・省略・順序入れ替えは禁止。

**【中段の本文は自由】**

冒頭2行に続く本文は、過去サンプルや決まったテンプレに囚われず、毎回自由に書いてよい。構成・行数・言い回しはすべて裁量。守るのは以下だけ:

- その日の曜日バリアント・特典・特記事項を自然に織り込む（「曜日別バリアント」の必須ルールに従う）
- **シーズンに1行触れる**（「シーズン（RPランキング）」の強度ルールに従う）。3案とも触れるが、切り口は変える（例: 案1は締切、案2は順位争い、案3は「今夜勝てば一気に上がる」）
- 3案で内容・言い回しが被らないようにする
- BabyPLOらしい、気軽で前向きなトーン（煽りすぎない、堅すぎない）

**【末尾は全案共通】**

```
#BabyPLO
https://baby-plo.app
```

### Step 3: 生成ルール

- **冒頭2行（「参加無料のオンラインPLOトーナメント / 今夜も22:00から開催です！」）は全案で必ず入れる**
- 絵文字は `💪` を基本に、増やしすぎない。`🔥` `🎯` `🏆` などは控えめに1個まで
- ハッシュタグは **`#BabyPLO` のみ**（複数付けない）
- URL は末尾 or ハッシュタグの直後に1回だけ
- 特記事項がない日は、AIレビューなど **直近の機能には触れない**（古くなった情報を使い回さない）
- シーズン名・締切日・順位は **`seasonConfig.ts` と当日のスクリプト出力から取った値だけ**を書く。前日のツイートや記憶からコピーしない
- 140字制限は意識するが、告知は長めでも可

### Step 4: 出力

3案それぞれをコードブロックで並べて提示する。各案の前に **どのトーン狙いか**を1行で添える（例: `# 案1: 特典押し`）。

- **対話実行**: 最後に「どれをベースに詰めますか？」と一言だけ確認する
- **自動実行（scheduled task から「投稿まで」を指示されている場合）**: 確認を挟まず、その日の切り口として一番効く案を
  自分で選んで Step 5 へ進む。選んだ理由を1行添える

ファイル保存・メモリ保存は **しない**（毎日書き捨て）。

### Step 5: 投稿（案が決まり、投稿を指示されている場合のみ）

0. **重複チェック（必須）**: scheduled task の二重発火があるため、過去セッションの記録から
   今日分の告知の「投稿完了 tweetId」を検索する。見つかったら **投稿せず** その tweetId を報告して終了する
1. **本文をファイルに書き出す**（scratchpad など。コマンドライン引数に本文を載せない）
2. **添付画像を選ぶ**: `server/src/modules/tweet/assets/` にバリアント別の告知画像がある。`announceImage.ts` の解決順に合わせる:
   - 金曜 → `friday_plo4.jpeg`（Happy Friday 版）
   - 通常PLO → `plo4.jpeg` / PLO8 → `plo8_hi_lo.jpeg` / 5-Card → `plo5_5card.jpeg` / Bomb Pot → `double_boards_bombpot.jpeg`
   - 画像は Read で一度中身を確認してから添付する（曜日・内容の食い違い防止）
3. **ドライラン → 実投稿**:

```bash
cd server && npx tsx scripts/post-tweet.ts --text-file=<path> --image=<path>            # ドライラン
cd server && npx tsx scripts/post-tweet.ts --text-file=<path> --image=<path> --confirm  # 実投稿
```

投稿完了したらツイートURLをユーザーに報告する。

**注意**: 実際のトナメ名は金曜でも `BabyPLO Daily M/D`（`server/src/modules/tournament/weeklySchedule.ts` の nameLabel は金曜も 'Daily'）。画像の「Happy Friday」は金曜ブランディング用バナーであり、本文のトナメ名を Happy Friday に変える根拠にはならない（変えるのはユーザー指示があるときだけ）。
