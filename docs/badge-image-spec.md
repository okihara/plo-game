# バッジ画像 仕様

AI に画像生成させる際の前提・スタイル統一ルール・カテゴリ別の差別化ルールをまとめる。実装側のバッジ定義は [server/src/modules/badges/badgeService.ts](../server/src/modules/badges/badgeService.ts)、加工フローは [.claude/commands/process-badge.md](../.claude/commands/process-badge.md) を参照。

## 1. キャンバス・出力

| 項目 | 値 |
|---|---|
| AI 生成サイズ | 1024×1024（正方形・不透過 OK） |
| フォーマット | PNG |
| 最終配信サイズ | 256×256 (`{name}.png`) / 512×512 (`{name}@2x.png`)、円形透過済み |
| 変換手段 | `/process-badge` スキルが自動でクロップ＋円形マスク |
| 安全領域 | 中央に内接円の **80% 以内** にメインモチーフを収める（円の端は確実に切れる） |
| 配置 | モチーフは厳密に中央、左右対称気味 |
| 表示時の最小想定サイズ | 60px 前後（プロフィール内 `w-[11cqw]`） |

## 2. ビジュアル基本ルール（全バッジ共通）

- **スタイル**: ヴィンテージ・エナメルステッカー／フラット・レトロイラスト
- **フレーム**: 外側に **クリームベージュの太い円縁**（既存バッジと同じ二重円構造）
- **テクスチャ**: 軽いグランジ／ノイズ、わざとらしい擦れ
- **配色パレット**:
  - 背景: ダスティ・ティールグリーン (`#5C7D72` 系) / ディープブラック (`#1A1A1A`)
  - アクセント: マスタードイエロー、サーモンレッド、クリーム、ティールブルー
- **禁止事項**:
  - 写真的リアリズム、3D レンダリング風
  - 強いグラデーション、グロス／鏡面反射
  - 焼き付け文字（数字以外）、ロゴ、ウォーターマーク
  - 細すぎる線（60px 表示で潰れる）

## 3. カテゴリ別ルール

| カテゴリ | 文字焼付 | 背景 | モチーフ指針 | レベル間の差 |
|---|---|---|---|---|
| `hands_*` | 数字 (`1000` / `3000` / `10K`) | ダスティグリーン系 | 中央に数字大、サブで本・紙束 | 1000=紙束 / 3000=分厚い本 / 10K=本棚・図書館（密度 UP） |
| `wins_*` | 数字 (`10` / `100` / `500`) | クリーム or ティール | 数字＋トロフィー or 月桂冠 | 10=控えめ / 100=月桂冠 / 500=王冠＋光輪で格上感 |
| `bad_beat_*` | なし | ディープブラック固定 | 「悲劇」感のモチーフ | fullhouse=砕けたフルハウス札 / quads=稲妻に砕かれる4枚 / straight_flush=神の手に拒まれる演出 |
| `daily_rank_1` | なし | ティールグリーン | トロフィー＋チップ＋星 | 単体 |
| `weekly_rank_1` | なし | ブラック | 王冠＋トロフィー＋月桂樹（daily より明確に格上） | 単体 |
| `tournament_no1` | `#1` | ティールグリーン | トロフィー＋月桂枝＋リボン | 単体（トーナメント優勝で都度付与） |
| `special` | なし | 自由 | フリースタイル（`first_penguin` 準拠） | — |

### 数字焼付のフォント仕様

既存 `hands_1000.png` を基準にする:

- 太いセリフ体
- 塗り: マスタードイエロー
- アウトライン: クリーム（細く）
- 数字の縦サイズは円内接の **40〜50%**
- カーニングはやや詰め気味

## 4. AI 生成プロンプト・テンプレート

```
A vintage enamel sticker badge, perfectly circular emblem, centered composition.
Double-ring frame with a thick cream-beige outer border.
Flat retro illustration style with subtle grunge and noise texture.
Muted palette: {BG_COLOR} background, accents in mustard yellow, salmon red,
cream, and teal blue. Single bold central motif: {MOTIF}.
{TEXT_BLOCK}
Readable at 60px. No photographic realism, no gradients, no glossy highlights,
no shadows, no extra text or logos.
1024x1024, square canvas, motif within the inner 80% of the circle.
```

差し替え変数:

- `{BG_COLOR}` — カテゴリ表を参照（例: `dusty teal green`、`deep black`）
- `{MOTIF}` — 例「a thick stack of papers with a red bookmark」
- `{TEXT_BLOCK}` — 数字焼付ありの場合のみ:
  ```
  Large numeric text "1000" centered in bold serif font,
  mustard yellow fill with thin cream outline,
  occupying 40-50% of the inner circle height.
  ```
  数字なしの場合: `No text in the image.`

## 5. 検証チェックリスト

新規バッジ画像を採用する前に確認する:

- [ ] 60px 表示でモチーフ／数字が判別できる
- [ ] 円形マスク後にモチーフ端が欠けていない（中央 80% 内に収まっている）
- [ ] 既存バッジと並べて違和感がない（配色・線の太さ・グランジ量）
- [ ] 同カテゴリ内でレベル差が一目で分かる
- [ ] 文字を焼き付ける場合は英数字のみ（多言語対応のため）

## 6. 追加手順

1. 上記テンプレートで AI（Gemini / Imagen など）で画像生成
2. 生成結果を `public/images/badges/source/` などに保存
3. `/process-badge <path> <name>` で 256/512px 円形 PNG に加工
4. `server/src/modules/badges/badgeService.ts` の `BADGE_META` に `imageUrl` 追加 or 既存上書きを確認
5. ProfilePopup / PlayerProfile で表示確認
