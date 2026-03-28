# テーブルバランサー（MTT）

マルチテーブルトーナメントで、**複数テーブル間の着席人数の偏り**を解消し、可能なら**テーブル枚数を減らす**ための仕組み。キャッシュゲームの FastFold（別席・別テーブルへの即時切替）とは無関係で、`TournamentInstance` が複数の `TableInstance` を束ねる文脈でのみ使われる。

## 責務の分割

| 層 | ファイル | 役割 |
|----|-----------|------|
| 純粋ロジック | [server/src/modules/tournament/TableBalancer.ts](../server/src/modules/tournament/TableBalancer.ts) | 現状スナップショットから「誰をどのテーブルへ動かすか」の指示（`BalanceAction[]`）だけを計算する。副作用なし。 |
| 実行 | [server/src/modules/tournament/TournamentInstance.ts](../server/src/modules/tournament/TournamentInstance.ts) | ソケット通知・着席・チップ引き継ぎ・空テーブル削除・再チェック。 |

`BalanceAction` は [server/src/modules/tournament/types.ts](../server/src/modules/tournament/types.ts) で `type: 'move' | 'break'` と `odId` / `fromTableId` / `toTableId` を持つ。いずれも「1人が元テーブルから退席し、先テーブルへ着席する」という実行形式は同じで、**複数人の一斉移動は複数アクションの列**として返る。

## 初期割当: `initialAssignment`

トーナメント開始時に全参加者の `odId` をテーブルに振り分ける。

1. **Fisher–Yates** でプレイヤーIDをシャッフルする。
2. テーブル数を `ceil(人数 / playersPerTable)` で決める（設定の `playersPerTable`、未指定時のデフォルトは [constants.ts](../server/src/modules/tournament/constants.ts) の `PLAYERS_PER_TABLE = 6`）。
3. シャッフル済みリストを**ラウンドロビン**で各テーブルに順番に配る。

その結果、テーブル間の人数差は高々 1 までに抑えられる（例: 7 人・定員 6 → 4 人卓 + 3 人卓）。

## バランス判定: `checkBalance`

引数は次のとおり。

- `tables`: 各テーブルの `{ tableId, playerCount, isHandInProgress }`
- `getPlayerIds(tableId)`: そのテーブルにいるプレイヤーの `odId` 配列（移動対象の**具体ID**を決めるときに使用）
- `playersPerTable`: 1卓あたりの定員（`initialAssignment` と同じ設定を渡す）

### ルールの優先順位

1. **テーブルが 1 枚だけ**  
   → 何もしない（空配列）。

2. **テーブル縮小（ブレイク）**  
   全プレイヤー数が `(テーブル数 - 1) × playersPerTable` 以下なら、**1枚減らしても全員が定員内に収まる**と判断する。  
   - 破壊対象の卓は、まず **`isHandInProgress === false` の卓を優先**し、その中で **`playerCount` が最小**の卓。  
   - 選んだ破壊卓が**ハンド中**の場合は、このラウンドでは**一切アクションを返さない**（空配列）。次のチェックまで待つ。  
   - 破壊卓の全員について、**残りの卓へ `playerCount` の昇順で均等に送る**ためのアクションを生成する（送るたびに内部の人数カウントを更新し、常に最も少ない卓へ載せる）。

3. **均等化移動（上記で縮小できないとき）**  
   人数最大の卓と最小の卓の差が **2 以上**のときだけ、**最大側から 1 人**を最小側へ移す。  
   - 移動元は **`getPlayerIds` の配列の末尾**（コメント上は「新しく着席した人を優先」）。  
   - **人数最大の卓がハンド中**の場合は、このラウンドでは**空配列**（移動しない）。

### ハンド中と空配列

`checkBalance` 内で「今すぐ動かしてはいけない」源テーブル（破壊対象卓、または人数最大卓）がハンド中と判断された場合は **アクションを返さない**。呼び出し側は、ハンド完了後など次のタイミングでもう一度 `checkBalance` することで追いつく。

`TournamentInstance` 側には `pendingMoves` があり、**返ってきたアクションの実行時**に移動元 `TableInstance` がハンド中ならキューに乗せ、後で実行する分岐がある。現行の `TableBalancer` は上記のとおりハンド中の移動元からはそもそもアクションを返さないため、このキューは主に**将来のロジック差異や防御**のための二重チェックに近い。

## 実行タイミング（`TournamentInstance`）

- **排除・ハンド決着後のフェーズ処理**  
  `onHandSettled` でチップ同期・バスト処理・（必要なら）ファイナルテーブル予約の処理のあと、`executePendingMoves()` が呼ばれる。ここで `pendingMoves` を処理し、末尾で **`checkAndExecuteBalance()` を再度**呼ぶ。

- **通常の卓間バランス**  
  `handlePhaseTransition` のうち、優勝確定・ヘッズアップ・**ファイナルテーブル形成条件**に当てはまらない場合、`checkAndExecuteBalance()` を呼ぶ。  
  ファイナルテーブルは「残り人数が `PLAYERS_PER_TABLE` 以下かつ卓が複数」など別条件で `scheduleFormFinalTable` が優先され、**卓の寄せ集めはバランサーではなく `formFinalTable` 側**で行う。

- **遅刻登録**  
  `lateRegister` で空きのある卓（人数が少ない卓優先）に着席したあと、`checkAndExecuteBalance()` を呼び、新規卓追加で偏りが出た場合に抑える。

`checkAndExecuteBalance` の流れの概要:

1. 全 `TableInstance` から人数・ハンド中フラグを集め `TableBalancer.checkBalance` に渡す。
2. 各 `BalanceAction` について `movePlayer`（ソケット `tournament:table_move` → 離席・`seatPlayerAtTable` → `tournament:table_assigned`、失敗時は元卓へ戻す）。
3. 人数 0 の卓を `tables` から削除。

単体テストの挙動例は [server/src/modules/tournament/__tests__/TableBalancer.test.ts](../server/src/modules/tournament/__tests__/TableBalancer.test.ts) を参照。

## 関連ドキュメント

- トーナメント全体: [tournament.md](./tournament.md)
- アーキテクチャ概要: [mtt-architecture.md](./mtt-architecture.md)
