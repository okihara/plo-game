# 7-Card Stud アーキテクチャ

## 概要

PLOポーカーゲームに追加された7-Card Stud (Fixed Limit) バリアント。コミュニティカードなし、プレイヤーごとに7枚（裏2-3枚 + 表1-4枚）を配る。

**設計方針**: `gameEngine.ts`（PLO）は一切変更せず保護。`studEngine.ts`を独立作成し、`VariantAdapter`パターンで`TableInstance`からの分岐を集約。

## PLO vs 7-Card Stud

| 項目 | PLO | 7-Card Stud |
|------|-----|-------------|
| コミュニティカード | 5枚共有 | なし |
| プレイヤーのカード | 4枚（全て裏） | 7枚（裏2-3 + 表1-4） |
| 強制ベット | SB + BB | アンテ + ブリングイン |
| ベット構造 | Pot Limit | Fixed Limit（Small/Big Bet） |
| ストリート | preflop → flop → turn → river | 3rd → 4th → 5th → 6th → 7th |
| アクション順 | ポジション固定 | 表カードの強さで決定 |
| ハンド評価 | hole 2枚 + community 3枚 | 7枚から最強5枚 (C(7,5)=21通り) |

## ファイル構成

### バックエンド

```
server/src/
├── shared/logic/
│   ├── studEngine.ts                    # Studゲームエンジン（685行）
│   ├── gameEngine.ts                    # PLOエンジン（変更なし）
│   ├── ai/
│   │   ├── studStrategy.ts              # Stud専用AI戦略
│   │   ├── strategyRegistry.ts          # variant別戦略ディスパッチ
│   │   └── ploStrategy.ts               # PLO専用AI戦略
│   └── __tests__/
│       └── studEngine.test.ts           # テスト（1248行、50+ケース）
├── modules/table/
│   └── helpers/
│       └── VariantAdapter.ts            # variant分岐の集約ヘルパー
└── bot/
    ├── index.ts                         # VARIANT=stud で起動
    └── BotClient.ts                     # variant対応済み
```

### 共有パッケージ

```
packages/shared/src/
├── types.ts          # GameVariant, Street拡張, upCards, ante, bringIn, betCount
├── protocol.ts       # ClientGameState.variant, OnlinePlayer.upCards
└── handEvaluator.ts  # evaluateStudHand(), evaluateShowingHand()
```

### フロントエンド

```
src/
├── components/
│   ├── StudActionPanel.tsx    # Fixed Limit用ベッティングUI（スライダーなし）
│   └── StudMyCards.tsx        # 自分のカード表示（裏カード青枠 + 表カード）
├── pages/
│   ├── OnlineGame.tsx         # variant分岐（StudActionPanel / StudMyCards）
│   └── SimpleLobby.tsx        # Studテーブル選択ボタン
└── hooks/
    └── useOnlineGameState.ts  # upCards / variant対応
```

## VariantAdapter パターン

`TableInstance`内のvariant分岐をすべて`VariantAdapter`に集約し、TableInstanceをクリーンに保つ。

```
TableInstance
  └── VariantAdapter (variant: GameVariant)
        ├── createGameState()     → studEngine / gameEngine
        ├── startHand()           → startStudHand / startNewHand
        ├── getValidActions()     → getStudValidActions / getValidActions
        ├── evaluateHandName()    → evaluateStudHand / evaluatePLOHand
        ├── getShowdownCards()    → [...holeCards, ...upCards] / holeCards
        └── broadcastStreetChangeCards()
              Stud: 新upCards再送信 + 7thでholeCards個別送信
              PLO:  no-op（コミュニティカードはgame:stateで送信）
```

## ゲームフロー

### startStudHand()

1. デッキシャッフル、ハンド状態リセット
2. 全プレイヤーからアンテ徴収 → ポット加算
3. 各プレイヤーに配布: `holeCards` = 2枚（裏）、`upCards` = 1枚（表 = ドアカード）
4. 最低ドアカード → ブリングインプレイヤー（同ランクなら♣<♦<♥<♠で決定）
5. ブリングイン徴収、次のプレイヤーからアクション開始

### ストリート進行 (moveToNextStudStreet)

| 遷移 | カード配布 | ベットサイズ | アクション順 |
|------|-----------|-------------|-------------|
| 3rd → 4th | +1枚 表 | Small Bet | 最高ショウイングハンド |
| 4th → 5th | +1枚 表 | **Big Bet に切替** | 最高ショウイングハンド |
| 5th → 6th | +1枚 表 | Big Bet | 最高ショウイングハンド |
| 6th → 7th | +1枚 **裏** | Big Bet | 6thと同じ順 |
| 7th → showdown | − | − | − |

### Fixed Limit ベッティング

- **Small Bet**: 3rd/4th Street（例: ブラインド1/3なら$3）
- **Big Bet**: 5th/6th/7th Street（= Small Bet × 2 = $6）
- **ブリングイン**: `ceil(ante / 2)`（例: $2）。コンプリート = Small Betまで
- **ベットキャップ**: 1ストリートあたり最大4ベット（bet → raise → re-raise → cap）

### アクション順序

- **3rd Street**: 最低ドアカード（ブリングインプレイヤー）から
- **4th Street以降**: 表カードで最強のハンドを見せているプレイヤーから
- オールインプレイヤーはスキップ

### ショーダウン (determineStudWinner)

1. アクティブ1人 → ポット全額獲得
2. アクティブ2人以上:
   - 残りカードを配って全員7枚にする
   - サイドポット計算
   - `evaluateStudHand([...holeCards, ...upCards])` で最強5枚評価
   - 同ランクならタイ分配
   - レーキ適用（3rd Streetフォールドは除外）

## WebSocketイベント

**新規イベント追加なし** — 既存チャネルで対応。

| イベント | Stud固有の挙動 |
|---------|---------------|
| `game:state` | `variant`, `ante`, 各プレイヤーの`upCards`を含む |
| `game:hole_cards` | 初回配布（2枚裏）+ 7th Street追加（1枚裏） |
| `game:all_hole_cards` | スペクテーター向け全裏カード送信 |
| `game:action_required` | Fixed Limit固定額のアクション選択肢 |
| `matchmaking:join` | `{ blinds, variant: 'stud' }` でStud指定 |

## AI戦略 (StudStrategy)

`AIVariantStrategy`インターフェースを実装。`strategyRegistry.ts`で`variant`に基づき自動選択。

```
cpuAI.ts → getVariantStrategy(variant) → StudStrategy.getAction()
```

**判定ロジック**:
- 5枚以上: `evaluateStudHand()` で正確なハンドランク計算
- 5枚未満（3rd/4th Street）: 簡易評価（高カード + ペア判定）
- パーソナリティ（VPIP, aggression, bluffFreq）でしきい値調整
- ポットオッズを考慮した判定

## テスト

```bash
cd server && npm test -- studEngine
```

**カバレッジ** (50+テストケース):
- ゲーム状態初期化、アンテ徴収、カード配布
- ブリングイン決定（最低カード、スートタイブレーカー）
- 全アクション（fold/check/call/bet/raise/allin）
- Fixed Limitベットキャップ、Small/Big Bet切替
- ストリート進行（3rd → showdown）
- アクション順序（4th Street以降のショウイングハンド判定）
- サイドポット、全員オールイン（studRunOut）
- ヘッズアップ、チップ不足アンテ、ブリングインオールイン

## 起動方法

### 開発環境

```bash
# ターミナル1: サーバー
cd server && npm run dev

# ターミナル2: フロントエンド
npm run dev

# ターミナル3: Studボット
cd server && VARIANT=stud BOT_COUNT=10 npm run bot
```

ブラウザで `http://localhost:5173` → ロビーの「7-Card Stud」セクションからテーブル選択。

### ボット起動

```bash
cd server

# 基本起動（10体、1/3ブラインド）
VARIANT=stud BOT_COUNT=10 npm run bot

# ウォッチモード（コード変更で自動再起動）
VARIANT=stud BOT_COUNT=10 npm run bot:dev

# 本番サーバーに接続
VARIANT=stud BOT_COUNT=10 npm run bot:prod
```

### ボット環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `VARIANT` | `''` (PLO) | `stud` を指定 |
| `BOT_COUNT` | `20` | ボット数（最大100） |
| `BLINDS` | `1/3` | ブラインド/アンテ設定 |
| `BOT_MAX_HANDS_PER_SESSION` | `80` | セッション上限ハンド数 |
| `SERVER_URL` | `http://localhost:3001` | 接続先サーバー |

### デバッグ

```bash
# 観戦モード（全カード表示）
open http://localhost:5173/spectate/<tableId>

# 管理ダッシュボード（テーブル一覧・プレイヤー状態）
open http://localhost:3001/admin/status
```

## バリアント拡張ガイド

新しいバリアントを追加する手順:

1. `packages/shared/src/types.ts` — `GameVariant`型に追加
2. `server/src/shared/logic/newVariantEngine.ts` — ゲームエンジン作成
3. `packages/shared/src/handEvaluator.ts` — ハンド評価関数追加
4. `server/src/shared/logic/ai/newVariantStrategy.ts` — AI戦略実装
5. `server/src/shared/logic/ai/strategyRegistry.ts` — 戦略登録（1行）
6. `server/src/modules/table/helpers/VariantAdapter.ts` — 分岐追加
7. `src/components/NewVariantActionPanel.tsx` — UI作成
8. `src/pages/SimpleLobby.tsx` — テーブル選択肢追加
