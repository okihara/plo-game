# 既知の不具合

## タイムアウト時に invalid アクションエラーが発生する

- **症状**: タイムアウト処理時に「invalid アクション」のエラーが出ることがあり、ゲームが進行不可能になる
- **原因**: ブラインド投入でオールインになったプレイヤーに `requestNextAction` がアクションを要求し、`validActions` が空のため全アクションが invalid になる
- **修正**: `requestNextAction` でオールインプレイヤーをスキップして `advanceToNextPlayer` へ進むガードを追加
- **状態**: 修正済み
