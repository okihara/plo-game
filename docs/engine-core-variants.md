# エンジン共通コア + バリアント記述子

2026-07 に、6 本のエンジン（gameEngine / studEngine / drawEngine / limitHoldemEngine /
omahaHiLoEngine / bombPotEngine、計約 4,100 行・各 600〜900 行がコピペ）を
**1 本の進行コア + バリアント記述子** に再構成した。
「バリアント = エンジン 1 本」という切り方をやめ、バリアントは宣言的な差分（記述子）になった。

## 置き場

```
server/src/shared/logic/engine/
├── core.ts          # 進行コア: startHand / applyAction / 次アクター決定 /
│                    #   ストリート進行 / determineWinner の骨組み（1本だけ）
├── descriptor.ts    # VariantDescriptor 型（差分の注入点の定義）
├── betting.ts       # ベッティング構造: potLimit / noLimit / fixedLimit 3系統
├── players.ts       # 座席走査・ポジション付与の共通ヘルパー
├── pots.ts          # サイドポット・レーキ・チップ分配
├── registry.ts      # GameVariant → 記述子（新バリアントはここに1行）
└── variants/
    ├── omaha.ts           # PLO / PLO5 / PLO6 / PLO8 / Big-O（1記述子で共用）
    ├── fixedLimitBoard.ts # Limit Hold'em / Omaha Hi-Lo
    ├── stud.ts            # Stud / Razz / Stud Hi-Lo（StudVariantRules を注入）
    ├── draw.ts            # 2-7 Triple Draw (FL) / Single Draw (NL)
    ├── bombPot.ts         # PLO Double Board Bomb Pot
    └── boardFlow.ts       # ボード系共通のストリート進行
```

旧 6 エンジンファイル（`gameEngine.ts` 等）は**公開 API を完全に維持した薄い委譲層**として残る。
テスト・AI 戦略・テーブル層の import は無変更で動く。`VariantAdapter` は registry 参照の
薄い橋渡しになった（UI 寄りの `evaluateHandName` / ブロードキャストは引き続きここ）。

## VariantDescriptor の構成

| 注入点 | 内容 | 例 |
|--------|------|-----|
| `resetHand` / `setup` | 強制ベット（ブラインド/アンテ/ブリングイン）、配牌、初期アクター | Stud はアンテ + 裏2表1、bomb pot は全員アンテで flop 開始 |
| `betting` | ベッティング構造（betting.ts の 3 系統から選択・パラメータ化） | PLO 系 = potLimit、LHE = boardFixedLimit |
| `flow` | ストリート順・ストリート入場時の配牌・最初のアクター・ランアウト | Stud は各街で1枚ずつ、draw は配らない |
| `showdown` | ポット構築（デッドマネー処理含む）・レーキ基準・勝者解決 | Hi-Lo スプリット / 2ボード半分割 / 2-7 ロー |
| `drawPhase` | カード交換フェーズ（Draw 系のみ） | discard 検証・捨て札山の再シャッフル |

**新バリアントの追加 = `variants/` に記述子ファイルを 1 つ書き、`registry.ts` に 1 行登録。**

## 挙動の互換性

リファクタは挙動変更ゼロを条件とし、次の 2 段で検証済み:

1. 既存のエンジンテスト群（gameEngine 105 / studEngine 63 / drawEngine 64 ほか、
   engine 系 385+ テスト）を無変更でグリーン
2. 新旧エンジンの差分テスト: シード付き乱数で全 13 バリアント × 2,000 ランダムハンド
   （ショートスタック・オールイン・chipUnit=100 を含む）を新旧に流し、
   全ステップの GameState と有効アクション一覧が完全一致することを確認

既存エンジン間で**意図的に統一しなかった**細部（従来挙動の保存）:

- Fixed Limit でチップがちょうど固定ベット額のときの `bet` vs `allin` の提示は
  LHE 系（`<=` で allin）と Stud/Draw 系（`>=` で bet）で異なる
- Stud はフルレイズ相当のオールインでも `lastFullRaiseBet` を更新しない
- ポット分配の `chipUnit`（トナメ 100 単位切り下げ）は PLO 系 / bomb pot のみが参照
- Draw のドロー経由でハンドが決着する経路はレーキパラメータを引き回さない（レーキ 0）

これらを変える場合は挙動変更の PR として、対応するテストとセットで行うこと。
