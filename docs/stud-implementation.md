# 7-Card Stud (Fixed Limit) 実装計画

## Context

PLOポーカーゲームに7-Card Studを追加する。Studはコミュニティカードなし、プレイヤーごとに7枚（表3-4枚+裏2-3枚）を配るゲーム。Fixed Limit（固定ベット額）でプレイする。

**設計方針**: gameEngine.tsは変更せずPLOを保護。studEngine.tsを新規作成し、TableInstanceでvariant分岐する。

## PLO vs 7-Card Stud 主要差分

| 項目 | PLO | 7-Card Stud |
|------|-----|-------------|
| コミュニティカード | 5枚共有 | なし |
| プレイヤーのカード | 4枚（全て裏） | 7枚（裏3 + 表4） |
| 強制ベット | SB + BB | アンテ + ブリングイン |
| ベット構造 | Pot Limit | Fixed Limit（Small/Big Bet） |
| ストリート | preflop→flop→turn→river | 3rd→4th→5th→6th→7th |
| アクション順 | ポジション固定 | 表カードの強さで決定 |
| ハンド評価 | hole2枚+community3枚 | 任意の5枚/7枚 |

## Phase 1: 型拡張（packages/shared/src/）

### types.ts — 最小限の追加

```typescript
export type GameVariant = 'plo' | 'stud';

// Street を拡張（既存の5つ + Stud用5つ）
export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'
  | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh';

// Player に1フィールド追加
export interface Player {
  // ...既存フィールド全て（変更なし）
  upCards: Card[];  // Stud: 表向きカード（PLO: 常に[]）
}
// ※ Studでは holeCards = 裏カード(2-3枚), upCards = 表カード(1-4枚)

// GameState に追加
export interface GameState {
  // ...既存フィールド全て（変更なし）
  variant: GameVariant;     // デフォルト 'plo'
  ante: number;             // Stud用（PLO: 0）
  bringIn: number;          // Stud用（PLO: 0）
  betCount: number;         // Fixed Limit: 現ストリートのベット回数
  maxBetsPerRound: number;  // Fixed Limit: 最大4ベット/ストリート
}
```

### protocol.ts — クライアント送信用

```typescript
// OnlinePlayer に追加
export interface OnlinePlayer {
  // ...既存フィールド
  upCards: Card[];  // Stud: 全員に見える表カード
}

// ClientGameState に追加
export interface ClientGameState {
  // ...既存フィールド
  variant: string;  // 'plo' | 'stud'
  ante: number;
}

// matchmaking:join に variant 追加
'matchmaking:join': (data: { blinds: string; isFastFold?: boolean; variant?: GameVariant }) => void;
```

### handEvaluator.ts — evaluateStudHand() 追加

既存の `evaluatePLOHand` と `evaluateFiveCardHand`（内部関数）を再利用。

```typescript
// 新規追加（既存コード変更なし）
export function evaluateStudHand(allCards: Card[]): HandRank {
  // 7枚から5枚: C(7,5) = 21通りを評価、最強を返す
}

export function evaluateShowingHand(upCards: Card[]): HandRank {
  // アップカードだけで見せ手の強さを評価（アクション順決定用）
}
```

`getCombinations` と `evaluateFiveCardHand` は現在private。同ファイル内に追加するので直接使える。

## Phase 2: Studゲームエンジン（server/src/shared/logic/studEngine.ts 新規）

gameEngine.tsから以下のexported関数をimportして再利用:
- `getActivePlayers()`, `getPlayersWhoCanAct()`
- `calculateSidePots()`, `calculateRake()`

### 公開API（gameEngine.tsと対称的な構造）

```typescript
export function createStudGameState(chips: number, ante: number, smallBet: number): GameState;
export function startStudHand(state: GameState): GameState;
export function applyStudAction(state: GameState, playerIndex: number, action: Action, amount: number, rakePercent: number, rakeCapBB: number): GameState;
export function getStudValidActions(state: GameState, playerIndex: number): ValidAction[];
export function wouldStudAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number): boolean;
export function determineStudWinner(state: GameState, rakePercent: number, rakeCapBB: number): GameState;
```

### startStudHand() フロー

1. デッキシャッフル、ハンド状態リセット
2. 全プレイヤーからアンテ徴収 → ポットに加算
3. 各プレイヤーに配布: `holeCards` = 2枚（裏）、`upCards` = 1枚（表＝ドアカード）
4. 最低ドアカードのプレイヤーにブリングイン設定（同ランクならスート♣<♦<♥<♠で決定）
5. ブリングインプレイヤーからアクション開始

### moveToNextStudStreet() フロー

```
third → fourth:  各プレイヤーに+1枚表。最高ショウイングハンドが先行。Small Bet
fourth → fifth:  各プレイヤーに+1枚表。最高ショウイングハンドが先行。Big Bet に切替
fifth → sixth:   各プレイヤーに+1枚表。同上
sixth → seventh: 各プレイヤーに+1枚裏。6thと同じアクション順。Big Bet
seventh → showdown
```

### Fixed Limit ベッティング

- **Small Bet**: 3rd/4th Street（例: $2）
- **Big Bet**: 5th/6th/7th Street（= Small Bet × 2 = $4）
- **最大4ベット/ストリート**: bet(1回目) → raise → re-raise → cap
- 4th Streetでペアが見えている場合、Big Betでのベット/レイズを許可（オプション、初期実装ではスキップ可）
- **ブリングイン**: Small Betの半額（例: $1）。コンプリート = Small Betまで上げる

### getStudValidActions()

```
- fold: 常に可能
- check: 現在のベットが0なら可能
- call: ベットがあれば可能（固定額）
- bet: ベットなし & betCount < 4 → Small/Big Bet固定額
- raise: ベットあり & betCount < 4 → Small/Big Bet固定額の上乗せ
- allin: チップが固定額未満の場合のみ
```

### アクション順序決定

```typescript
function getStudFirstActor(state: GameState): number {
  if (state.currentStreet === 'third') {
    // 最低ドアカード（ブリングイン）のプレイヤー
    return findLowestUpCard(state);
  }
  // 4th street以降: 最高ショウイングハンドのプレイヤー
  return findBestShowingHand(state);
}
```

## Phase 3: サーバー統合

### TableInstance.ts — variant分岐の追加

```typescript
class TableInstance {
  public readonly variant: GameVariant;

  // startNewHand() 内
  if (this.variant === 'stud') {
    this.gameState = startStudHand(this.gameState);
    // holeCards（裏カード）を各プレイヤーに個別送信
    // upCardsはgame:state経由で全員に可視
  } else {
    this.gameState = startNewHand(this.gameState);  // 既存PLO
  }

  // handleAction() 内のエンジン切替
  // handleAllInRunOut() — Studではスキップ（コミュニティカードなし）
  // handleHandComplete() — ハンド評価をevaluateStudHand()に分岐
}
```

### ActionController.ts

```typescript
// getValidActions / applyAction をvariantで分岐
const validActions = state.variant === 'stud'
  ? getStudValidActions(state, seatIndex)
  : getValidActions(state, seatIndex);
```

### StateTransformer.ts

- `toClientGameState()`: variant, ante フィールドを追加
- `seatToOnlinePlayer()`: `upCards` フィールドを追加（PLOでは`[]`）

### BroadcastService.ts — ストリートごとのカード送信

Studでは各ストリートで新しいカードが配られた後:
- 新しい表カード → `game:state` の `players[].upCards` で全員に可視
- 新しい裏カード（7th streetのみ）→ `game:hole_cards` で該当プレイヤーに個別送信
- **新規イベント追加不要**（既存チャネルで対応可能）

### その他ヘルパー

- `SpectatorManager.ts`: Studでは `game:all_hole_cards` で裏カード（holeCards）を送信
- `HandHistoryRecorder.ts`: ハンド評価を `evaluateStudHand()` に分岐
- `TableManager.ts`: `findAvailableTable()` に variant フィルター追加
- `handlers.ts`: matchmaking:join で variant パラメータを受け渡し

## Phase 4: クライアントUI

### PokerTable.tsx — コミュニティカード条件分岐

```tsx
{variant !== 'stud' && <CommunityCards ... />}
```

### Player.tsx — 他プレイヤーのカード表示

```tsx
// 現在: Array(4).fill(null) で4枚の裏カード（PLO固定）
// 変更: variantで分岐

{variant === 'stud' ? (
  // Stud: upCardsは表面表示 + 裏カード枚数分のFaceDownCard
  <>
    {Array(player.downCardCount || 2).fill(null).map((_, i) => <FaceDownCard key={i} />)}
    {player.upCards.map((card, i) => <Card key={`up-${i}`} card={card} />)}
  </>
) : (
  // PLO: 既存コード（変更なし）
)}
```

### MyCards.tsx — 自分のカード表示

```tsx
{variant === 'stud' ? (
  // 自分の全カードを表示（裏カードも自分には見える）
  // downCards（やや暗い枠で区別） + upCards
) : (
  // PLO: 既存コード
)}
```

### ActionPanel.tsx — Fixed Limit対応

```tsx
{variant === 'stud' ? (
  // Fixed Limit: スライダー不要、3ボタン（Fold / Check or Call / Bet or Raise）
  // 金額は固定なのでシンプル
) : (
  // PLO: 既存のPot Limitパネル（変更なし）
)}
```

## Phase 5: テストと検証

### ユニットテスト（server/src/shared/logic/__tests__/）

- `studEngine.test.ts`: startStudHand、アクション処理、ストリート進行、Fixed Limit上限
- `handEvaluator.test.ts`: evaluateStudHand（7枚→5枚の全組み合わせ）

### 統合テスト

1. `npm run dev` でサーバー + クライアント起動
2. Studテーブルに3人以上着席してハンド開始を確認
3. `/spectate/:tableId` で全員の裏カード+表カードが正しく表示されるか確認
4. 各ストリートでカードが正しく配布されるか確認
5. Fixed Limitの固定額ベット/レイズが正しく動作するか
6. ショーダウンで正しいハンド評価と勝者決定
7. PLOテーブルが従来通り動作することを確認（回帰テスト）

## 変更ファイル一覧

### 新規作成
- `server/src/shared/logic/studEngine.ts` — Studゲームエンジン
- `server/src/shared/logic/__tests__/studEngine.test.ts` — テスト

### 変更（型追加のみ、ロジック変更なし）
- `packages/shared/src/types.ts` — GameVariant, upCards, ante等追加
- `packages/shared/src/protocol.ts` — OnlinePlayer.upCards, ClientGameState.variant追加
- `packages/shared/src/handEvaluator.ts` — evaluateStudHand()追加

### 変更（variant分岐追加）
- `server/src/modules/table/TableInstance.ts` — エンジン切替の中心
- `server/src/modules/table/helpers/ActionController.ts` — バリデーション/アクション分岐
- `server/src/modules/table/helpers/StateTransformer.ts` — upCards, variant送信
- `server/src/modules/table/helpers/SpectatorManager.ts` — Stud裏カード送信
- `server/src/modules/table/helpers/HandHistoryRecorder.ts` — ハンド評価分岐
- `server/src/modules/table/TableManager.ts` — variant フィルター
- `server/src/modules/game/handlers.ts` — variant受け渡し

### 変更（UI分岐追加）
- `src/components/Player.tsx` — Stud表カード表示
- `src/components/MyCards.tsx` — Stud自分のカード
- `src/components/ActionPanel.tsx` — Fixed Limit用簡易パネル
- `src/components/PokerTable.tsx` — コミュニティカード条件分岐
- `src/hooks/useOnlineGameState.ts` — upCards/variant対応

### 変更なし（PLO保護）
- `server/src/shared/logic/gameEngine.ts` — 一切変更なし
