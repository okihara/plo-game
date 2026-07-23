# ゼロから設計し直すなら（アーキテクチャ設計メモ）

「もし一から設計できるとしたら」の思考実験を設計メモとして残す。2026-07 時点のコードベース（`docs/refactoring-plan.md` の負債調査を含む）を前提に、**変えるのは構造の4点、土台はそのまま**という結論。

書き直しの提案ではない。理想形を明文化しておき、日々のリファクタや新機能の設計判断が向かう先を揃えるためのメモ。

## 結論サマリー

技術スタック（Fastify + Socket.io + Prisma/PostgreSQL、React + Vite + Tailwind、モノレポ、JWT Cookie 認証、Railway）は現状のままで正解。ゼロからなら変えるのは：

1. エンジンを6本ではなく「1本のコア + バリアント記述子」にする
2. ハンドをイベントソーシングにする
3. TableInstance を「アクター + ポート」に分解する
4. プロトコルを単一の真実の源泉 + 実行時検証にする

---

## 1. エンジン: 「バリアント = エンジン1本」をやめ、直交3軸の記述子にする

### 現状の問題

`gameEngine` / `studEngine` / `drawEngine` / `limitHoldemEngine` / `omahaHiLoEngine` / `bombPotEngine` の6本に約600〜900行ずつコピペがある（`refactoring-plan.md` Phase 2）。根本原因は「バリアント＝エンジン1本」という切り方。新バリアント追加のコストが「600行の新エンジン + テスト1,000行」になっている。

`VariantAdapter` は if/switch の集約点として機能しているが、omaha_hilo の特例、bomb pot の ante 上書き、stud の SB/4 ante といった差分を手続きで吸収しており、バリアントの定義が宣言的に読めない。

### あるべき形

ポーカーのバリアントは実際には**直交する3軸の組み合わせ**：

| 軸 | 選択肢 | 差分の実体 |
|----|--------|-----------|
| ベット構造 | no-limit / pot-limit / fixed-limit | ベッティングラウンド1実装のパラメータ化（minRaise 動的更新 vs betCount + 固定額） |
| ディール構造 | ボード型 / スタッド型（アップカード） / ドロー型（交換フェーズ） | ストリート進行の定義 |
| ハンド評価 | high / low / hi-lo split | 評価関数の注入（`packages/shared/src/handEvaluator.ts` は既にこの形に近い） |

`packages/engine` を純関数のコアとして作り、バリアントは**記述子（データ + 注入関数）**にする：

```ts
const PLO: VariantSpec = {
  dealing: communityCards({ hole: 4, streets: [3, 1, 1] }),
  betting: potLimit(),
  showdown: highOnly(evaluatePLOHand),
}
```

サイドポット・レーキ・端数処理・チップ分配は全バリアントで1実装。新バリアント追加は「記述子1個 +（必要なら）評価関数」になる。現行 `VariantAdapter` の手続き的な特例は、すべて記述子の中に宣言として収まる。

### 現行コードとの接続

`refactoring-plan.md` Phase 2（エンジン共通コア抽出）と 2-4（`PokerEngine` インターフェース化）は、この方向への漸進ステップそのもの。既存の厚いエンジンテスト（gameEngine 1,944行ほか）が回帰防止網になる。

## 2. ハンド進行: イベントソーシング

### 現状の問題

エンジンは「新しい GameState」を返し、その状態から複数の関心事がそれぞれ別の方法で情報を再構築している：

- `HandHistoryRecorder` はハンド完了時に状態からハンド履歴を再構築
- Socket 配信は `StateTransformer.toClientGameState()` で状態を変換し、クライアントは `useOnlineGameState`（553行）で GameState に**再変換**する往復がある
- オールインのランアウト演出（`TableInstance.handleAllInRunOut`、約150行）はエンジン呼び出しとタイマーが交錯
- ハンドの再現は `server/scripts/replay-hand-*.ts` のような使い捨てスクリプト頼み

### あるべき形

エンジンの出力を**ドメインイベントの列**にする：

```
HandStarted → BlindsPosted → HoleCardsDealt → ActionTaken(fold)
  → StreetAdvanced(flop) → ... → PotAwarded → HandEnded
```

状態はイベントの畳み込み（fold）で導出。現在バラバラの4つが**同じイベントログの別ビュー**に統一される：

1. **ハンド履歴** — 保存はログの append だけ。再構築コードが消える
2. **クライアント配信** — Socket イベントはドメインイベントを視点ごとに**リダクション**（他人のホールカードを伏せる）したもの。「GameState → ClientGameState → クライアントで GameState に再変換」の往復が消える。クライアントはイベントから射影を組み立てる
3. **演出のペーシング** — ランアウト演出は「イベントを遅延つきで再生するプレゼンテーション層」になり、エンジンから完全分離
4. **リプレイ・デバッグ** — シード付きデッキ + イベントログで任意のハンドを決定的に再現

### 適用範囲の限定（重要）

イベントソーシングは概念が増える。適用は**1ハンドのスコープ内に限定**し、システム全体の CQRS 化はやらない。ウォレット・チップ残高は普通のトランザクション + 台帳テーブル（buy-in / cash-out / rake の記録）で十分。

漸進導入も可能: 書き直しなしでも「エンジンが状態更新と同時にイベントを発行する」形から始められる。

## 3. テーブル層: アクター + ポート

### 現状の問題

`TableInstance`（約1,400行）が着席管理・ハンド進行・タイマー・切断猶予・観戦者・HORSE ローテーション・ショーダウン演出・ブロードキャストを1クラスで抱えている。`PlayerManager` / `BroadcastService` / `ActionController` への委譲は始まっているが、時間（タイマー）と配信と進行が同居している。

また Bot は `BotClient`（約1,000行）がソケットクライアントを模倣して接続しており、Bot のためにネットワーク層を経由している。

### あるべき形

handlers.ts（odId・DB・外側）/ Table（seatIndex・進行・内側）の責務境界は正しいので維持し、内側をさらに分ける：

- **Table アクター**: 座席とハンドライフサイクルの状態機械だけを持つ。メッセージ（着席・アクション・タイムアウト）を逐次処理し、並行性の問題を構造で排除
- **ポート（interface）を注入**: `Clock`（タイマー・切断猶予）、`DeckSource`（シャッフル。テストではシード固定）、`Notifier`（配信）、`HandStore`（永続化）。socket.io なしでテーブル全体をテスト可能に
- **Bot は in-process の PlayerAgent**: 「人間 = Socket アダプタ、Bot = AI 戦略アダプタ」で同じ `PlayerAgent` インターフェース（`onEvent` / `decideAction`）の実装にする。`BotClient` のソケット模倣が不要になり、Bot を混ぜた統合テストが軽くなる

## 4. プロトコル: スキーマを正とし実行時検証

### 現状の問題

- `packages/shared/src/protocol.ts` に型はあるが、`src/services/websocket.ts` でイベント名文字列と `WsListeners` 型が二重管理（`refactoring-plan.md` 3-2）
- サーバー入口での実行時検証がなく、不正ペイロードは各ハンドラの防御的コードに依存
- `server/src/shared/` は実際にはサーバー専用で「shared」という名前が嘘になっている（Phase 4 のリネーム対象）
- equity 計算がクライアント/サーバーで別実装（Phase 1 最優先課題）

### あるべき形

- **zod スキーマを正**にして TS 型を導出。サーバー入口で実行時検証、クライアントは型からリスナーを自動導出。イベント名タイポはコンパイルエラーになる
- パッケージ境界を最初から `packages/engine`（真の共有: エンジン・評価・equity）と `server/src/engine-host`（サーバー固有のホスティング）に分ける。「共有すべきものが2実装に分かれる」類の負債は、共有パッケージ第一で始めれば発生しない

---

## 変えないこと

- **handlers / Table の責務境界** — odId 起点の外側と seatIndex 起点の内側という分担は正しく、実際守られている
- **Fastify + Socket.io + Prisma** — 規模に対して適切。Repository 層の追加は過剰設計（`refactoring-plan.md` の判断に同意）
- **厚いエンジンテスト文化** — ゼロからでも最初から維持する
- **cqw ベースの 9:16 モバイルレイアウト設計**（`docs/ui-mobile-layout.md`）
- **クライアントの構成** — React + Vite + Tailwind、カスタムルーティング。API クライアント層の一元化（Phase 3-1）だけは最初からやる

## refactoring-plan.md との関係

この理想形の大半は `refactoring-plan.md` Phase 1〜2 が既に向かっている方向：

| 本メモ | refactoring-plan.md |
|--------|---------------------|
| 直交3軸のエンジンコア | Phase 2-1〜2-3（共通コア抽出）、2-4（PokerEngine インターフェース） |
| プロトコル単一化 | Phase 3-2（イベント名の二重管理解消） |
| 共有パッケージ第一 | Phase 1（equity 一本化）、Phase 4（shared リネーム） |
| イベントソーシング | **対応なし — 本メモで唯一の新規要素** |
| Bot の in-process 化 | 対応なし（将来の候補） |

したがって実行順は refactoring-plan.md のフェーズをそのまま進めればよく、その先の到達点として「エンジンがイベントを発行する」「Bot が PlayerAgent になる」を見据える。
