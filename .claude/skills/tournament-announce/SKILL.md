---
name: tournament-announce
description: Use this skill when the user wants to draft a daily tournament announcement tweet for the plo-game project (BabyPLO). Triggered by `/tournament-announce` (optionally with date or freeform notes like 曜日・特典・新機能). Generates Japanese promotion tweets in the existing BabyPLO announcement style, and—after the user picks a draft and asks to post—can post it with the variant-specific announce image to the official account via post-tweet.ts.
---

# Tournament Announce

plo-game（BabyPLO）の毎日トナメ **開催告知** ツイート下書きを作るスキル。結果ツイート（`/tournament-tweet`）と対になる、開催前の宣伝用。

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

## Workflow

### Step 1: 文脈整理

ユーザー入力から以下を抽出する（なければ省略）:

- 日付 / 曜日 / 祝日
- 特典・キャンペーン（例: 金曜の Amazon ギフト券）
- 新機能・直近のアップデート（例: AIレビュー）
- 気分・トーン寄せ（例: 月曜の憂鬱、連休中、平日夜）

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
- 140字制限は意識するが、告知は長めでも可

### Step 4: 出力

3案それぞれをコードブロックで並べて提示する。各案の前に **どのトーン狙いか**を1行で添える（例: `# 案1: 特典押し`）。最後に「どれをベースに詰めますか？」と一言だけ確認する。

ファイル保存・メモリ保存は **しない**（毎日書き捨て）。

### Step 5: 投稿（ユーザーが案を選んで投稿を指示した場合のみ）

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
