# 既知の不具合

## タイムアウト時に invalid アクションエラーが発生する

- **症状**: タイムアウト処理時に「invalid アクション」のエラーが出ることがあり、ゲームが進行不可能になる
- **原因**: ブラインド投入でオールインになったプレイヤーに `requestNextAction` がアクションを要求し、`validActions` が空のため全アクションが invalid になる
- **修正**: `requestNextAction` でオールインプレイヤーをスキップして `advanceToNextPlayer` へ進むガードを追加
- **状態**: 修正済み

## handleHandComplete の二重呼び出しでテーブルが固まる

- **症状**: `handleHandComplete error: TypeError: Cannot read properties of null (reading 'winners')` が発生し、テーブルが進行不能になる
- **原因**: `handleHandComplete()` は async 関数で、showdown delay と hand complete delay の `await` がある。この `await` 中に同じメソッドが再度呼ばれると、先に完了した側が `this.gameState = null`（line 1032）を実行し、まだ `await` 待ちだった最初の呼び出しが再開した時点で `this.gameState` が `null` になりクラッシュする
- **修正案**: `isHandCompleteInProgress` フラグで二重呼び出しを防止し、`await` 後に `this.gameState` の null チェックを追加
- **状態**: 未修正
