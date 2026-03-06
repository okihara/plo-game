# Draw系 UI + プラミング実装計画

## Context
Triple Draw (2-7 Lowball) のゲームエンジンは完成済みだが、UIとサーバー統合が未実装。
`StudActionPanel` は実質 Fixed Limit 汎用パネルなのでリネームし、Draw のベッティングフェーズでも再利用する。
ドローフェーズ用に新規 `DrawPhasePanel` と `MyCards` のカード選択機能を追加する。

## 実装ステップ

### Step 1: 共有型・プロトコル拡張
- `packages/shared/src/types.ts` — `isDrawStreet()` ヘルパー追加
- `packages/shared/src/protocol.ts` — `game:action` に `discardIndices?: number[]` 追加

### Step 2: サーバー側プラミング（discardIndices を通す配管）
- `server/src/modules/table/helpers/VariantAdapter.ts`
  - `isDrawFamily` 分岐を全メソッドに追加（createGameState, startHand, getValidActions, applyAction, wouldAdvanceStreet, determineWinner, evaluateHandName, broadcastStreetChangeCards）
  - `applyAction` / `wouldAdvanceStreet` に `discardIndices?` パラメータ追加
  - tripleDrawEngine の関数群を import して呼び出す
- `server/src/modules/table/helpers/ActionController.ts`
  - `handleAction` に `discardIndices?` パラメータ追加
  - draw アクションのバリデーション: discardIndices の長さで判定（0〜5）
- `server/src/modules/table/TableInstance.ts`
  - `handleAction(odId, action, amount, discardIndices?)` にシグネチャ変更
  - `getDefaultDisconnectAction` — draw フェーズなら `{action:'draw', amount:0, discardIndices:[]}` (stand pat)
  - handleAction 呼び出し箇所すべてに discardIndices を通す
- `server/src/modules/game/handlers.ts`
  - `handleGameAction` — data から `discardIndices` を取り出して `table.handleAction` に渡す

### Step 3: クライアント側プラミング
- `src/services/websocket.ts` — `sendAction(action, amount?, discardIndices?)` に拡張
- `src/hooks/useOnlineGameState.ts` — `handleAction(action, amount, discardIndices?)` に拡張

### Step 4: FixedLimitActionPanel（リネーム + 汎用化）
- `src/components/StudActionPanel.tsx` → `src/components/FixedLimitActionPanel.tsx`
- コンポーネント名 `StudActionPanel` → `FixedLimitActionPanel`
- ベットサイズ判定を variant 分岐:
  - Stud: `['third','fourth']` → smallBlind / else → bigBlind
  - Draw: `['predraw','postdraw1']` → smallBlind / else → bigBlind
- BringIn ロジックを `isStudFamily` ガードで囲む（Draw には bringIn なし）
- OnlineGame.tsx と index.ts のインポート更新

### Step 5: DrawPhasePanel（新規）
- `src/components/DrawPhasePanel.tsx`
- Props: `state`, `mySeat`, `selectedCardIndices`, `onAction`
- 1ボタン: 選択0枚なら「STAND PAT」(青)、1枚以上なら「DRAW X」(オレンジ)
- ドロー回数表示（First Draw / Second Draw / Final Draw）

### Step 6: MyCards カード選択機能
- `src/components/MyCards.tsx` に props 追加: `isDrawPhase?`, `selectedCardIndices?`, `onCardToggle?`
- ドローフェーズ中はカードタップで選択/解除
- 選択カードは `translateY(-3cqw)` でスライドアップ + 赤丸マーカー
- 5枚表示なのでカードサイズ sm、gap 1cqw（Stud と同じ）

### Step 7: OnlineGame.tsx 統合
- `selectedCardIndices` state 管理、`handleCardToggle` コールバック
- ストリート変更時に selectedCardIndices リセット
- アクションパネル3分岐:
  1. `tripdraw && isDrawStreet` → DrawPhasePanel
  2. `isStudFamily || isDrawFamily` → FixedLimitActionPanel
  3. else → ActionPanel（PLO）
- MyCards に draw 関連 props を渡す

### Step 8: ロビー・履歴対応
- `src/pages/SimpleLobby.tsx` — Triple Draw リンク追加
- `server/src/modules/game/handlers.ts` — VALID_VARIANTS に `'tripdraw'` 追加（Step 2で対応）

## 対象ファイル一覧
| ファイル | 変更内容 |
|---------|---------|
| `packages/shared/src/types.ts` | `isDrawStreet()` 追加 |
| `packages/shared/src/protocol.ts` | `discardIndices` 追加 |
| `server/.../VariantAdapter.ts` | tripdraw 分岐 + discardIndices |
| `server/.../ActionController.ts` | discardIndices パラメータ |
| `server/.../TableInstance.ts` | handleAction + disconnect 対応 |
| `server/.../handlers.ts` | discardIndices 通し |
| `src/services/websocket.ts` | sendAction 拡張 |
| `src/hooks/useOnlineGameState.ts` | handleAction 拡張 |
| `src/components/StudActionPanel.tsx` | → FixedLimitActionPanel にリネーム+汎用化 |
| `src/components/DrawPhasePanel.tsx` | 新規作成 |
| `src/components/MyCards.tsx` | カード選択機能 |
| `src/pages/OnlineGame.tsx` | 統合 |
| `src/pages/SimpleLobby.tsx` | リンク追加 |

## 検証
- `cd server && npx tsc --noEmit` — サーバー型チェック
- `npm run build` — クライアントビルド
- `cd server && npm test` — 既存テスト通過確認
