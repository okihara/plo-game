# PLO Double Board Bomb Pot トーナメント

トーナメント専用の特殊バリアント `plo_double_board_bomb` の設計メモ。

## 仕様

| 項目 | 値 |
|---|---|
| 適用範囲 | トーナメントのみ（キャッシュ非対応） |
| ベース | PLO（ホール 4 枚） |
| プリフロップ | **なし**（全員アンテ → 即フロップ） |
| アンテ | **全員 1 BB**（足りない場合は持っているチップ全部 → all-in） |
| ボード数 | **2**（ダブルボード固定。シングルボード版は無し） |
| ベッティング | フロップ → ターン → リバーの3ストリート、Pot Limit。両ボード共通の単一ポット |
| ポット分割 | 各 contested side pot を **½ ずつ** 2ボードに割り当て、ボード毎に独立評価 |
| 端数 | 半分割で奇数なら **ボード 1 が +1 チップ** |
| 同点 (chop) | ボード毎にチョップ。半分割が割り切れない端数は最初の勝者へ |
| ボタン進行 | 通常 PLO と同じ（SB/BB ラベルは内部で振るが、ブラインドは投稿しない） |
| 最初に行動 | SB（ヘッズアップ時は BB） — 通常のポストフロップと同じ |
| variant 識別子 | `plo_double_board_bomb` |
| トーナメント全体 | このトーナメントは**全ハンドが Double Board Bomb Pot**。途中で通常 PLO に切り替わらない |

## アーキテクチャ方針

- **新 variant として追加**（`'plo_double_board_bomb'`）。`VariantAdapter` がこの variant を見て分岐する想定。
- **既存 `gameEngine` を書き換えない**（O原則）。ロジックは `bombPotEngine.ts` に分離。
- ベッティング判定（`getValidActions` / `determineNextAction`）は通常 PLO と同一なので gameEngine の関数を再利用。
- カード配布・ストリート遷移・勝者決定だけ bomb pot 用に書き起こし。

## GameState の拡張

```ts
GameState {
  ...既存...
  boards?: Card[][];   // double board 時に [board1, board2] が入る。それ以外は undefined
  communityCards: Card[];  // bomb pot 中は boards[0] と同期（後方互換）
}
```

`boards` を canonical とし、`communityCards` は board1 のミラーとして同期する。既存の Reader（ログ等）が壊れない範囲で双方を持つ。

## ポット分配ロジック

各 contested side pot 額 `A` について:
1. `half = floor(A / 2)`、`extra = A - 2 * half`（0 or 1）
2. **Board 1 ポット = `half + extra`** / Board 2 ポット = `half`
3. 各ボードについて eligible プレイヤーの `evaluatePLOHand(holeCards, boards[k])` を比較し勝者を決定
4. ボード内チョップは均等分配、端数は最初の勝者に付与
5. `winners[]` には (playerId, board, amount, handName) を 1 エントリずつ push（同一プレイヤーが両ボードで勝てば 2 エントリ）

## 実装ファイル

- `packages/shared/src/types.ts` — `GameVariant` に `'plo_double_board_bomb'` 追加、`VARIANT_CONFIGS` に登録、`GameState.boards` 追加
- `server/src/shared/logic/bombPotEngine.ts` — ロジック本体
- `server/src/shared/logic/__tests__/bombPotEngine.test.ts` — テスト

## 今後（このメモのスコープ外）

ゲームロジック + テスト以降の作業:

- `VariantAdapter` の bomb pot 経路追加（`createGameState` / `startHand` / `determineWinner` / `wouldAdvanceStreet`）
- `ClientGameState` への `boards` 追加（packages/shared/src/protocol.ts）
- `TableInstance.handleAllInRunOut` の 2 ボード並列開示
- クライアント描画（PokerTable / CommunityCards の 2 ボード対応）
- ハンド履歴 (`HandHistory.board2` カラム / PokerStars Hand History 出力拡張)
- Tournament 設定への `gameVariant: 'plo_double_board_bomb'` 設定 UI / シードスクリプト
- Bot AI のダブルボード equity 評価
