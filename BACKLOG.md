# BACKLOG

やることリスト。完了したら削除するか「## 完了」へ移す。

## 優先度: 高

- [ ] `handleHandComplete` 二重呼び出しでテーブルが固まる不具合の修正
  - **症状**: `handleHandComplete error: TypeError: Cannot read properties of null (reading 'winners')` でテーブルが進行不能になる
  - **原因**: async な `handleHandComplete()` の `await`（showdown / hand complete delay）中に同メソッドが再度呼ばれると、先に完了した側が `this.gameState = null` を実行し、再開した最初の呼び出しで `this.gameState` が null になりクラッシュ
  - **修正案**: `isHandCompleteInProgress` フラグで二重呼び出しを防止し、`await` 後に `this.gameState` の null チェックを追加

## 優先度: 中

- [ ] 一般用観戦モード
- [ ] テーブルバランス: フォールド中のユーザーを安全に移動させる

## アイデア / 未着手

- [ ] レイト締め切りが過ぎるまでプレイスカードを表示しない
- [ ] dashboard の観戦ボタンを固定位置に
- [ ] リエントリーのバグ調査（池田さん報告）

## 完了

<!-- 完了した項目をここへ移す -->
