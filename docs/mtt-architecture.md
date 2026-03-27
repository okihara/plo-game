# MTT（マルチテーブルトーナメント）アーキテクチャ

## 概要

PLO ポーカーゲームの MTT 機能。既存の `TableInstance` をトーナメントモード (`gameMode: 'tournament'`) で利用し、`TournamentInstance` が複数テーブルのライフサイクル・ブラインド進行・バスト順位・テーブルバランシングを統括する。

---

## ファイル構成

```
server/src/modules/tournament/
├── TournamentInstance.ts   # 1つのトーナメントのコアロジック
├── TournamentManager.ts    # 複数トーナメントの管理・DB永続化
├── socket.ts               # Socket.io イベントハンドラ
├── routes.ts               # 管理 REST API
├── types.ts                # 型定義（サーバー専用）
├── constants.ts            # デフォルト定数
├── BlindScheduler.ts       # ブラインドレベル自動進行
├── PrizeCalculator.ts      # 賞金計算（純粋関数）
├── TableBalancer.ts        # テーブル人数バランシング（純粋関数）
└── __tests__/              # ユニットテスト

server/src/bot/
├── BotClient.ts            # ボット（トーナメントモード対応）
├── TournamentBotManager.ts # トーナメント用ボット管理
└── tournamentBot.ts        # ボットトーナメント起動スクリプト

packages/shared/src/
├── tournament.ts           # Client/Server 共有型
└── protocol.ts             # Socket イベント型定義

src/
├── pages/TournamentLobby.tsx       # トーナメント一覧・登録 UI
├── pages/TournamentGame.tsx        # トーナメントゲーム画面ラッパー
├── hooks/useTournamentState.ts     # トーナメント状態管理フック
├── components/TournamentHUD.tsx    # ゲーム中 HUD オーバーレイ
├── components/EliminationOverlay.tsx   # 脱落画面
├── components/TournamentResultOverlay.tsx # 結果画面
└── components/TableMoveOverlay.tsx  # テーブル移動画面
```

---

## トーナメントライフサイクル

```
registering ──[start()]──→ starting → running
                                        │
                          [残り ≤ PLAYERS_PER_TABLE] → final_table
                                        │
                               [残り = 2] → heads_up
                                        │
                               [残り = 1] → completed
```

### 各フェーズの説明

| フェーズ | 説明 |
|---------|------|
| `registering` | 参加受付中。登録/解除が可能 |
| `starting` | `start()` 直後。テーブル割り当て処理中 |
| `running` | ハンド進行中。ブラインド自動上昇、テーブルバランシング稼働 |
| `final_table` | 残りプレイヤーが 1 テーブルに収まるため統合 |
| `heads_up` | 2 人の最終対決 |
| `completed` | 終了。結果を DB 保存、賞金支払い |
| `cancelled` | 管理者によるキャンセル。バイイン全額返還 |

---

## プレイヤー状態マシン

```
registered ──[start()]──→ playing ←→ disconnected（切断/再接続）
                             │
                    [チップ = 0] → eliminated
                             │
                 [enterPlayer()] → playing（リエントリー）
```

| 状態 | 説明 |
|------|------|
| `registered` | 登録済み・トーナメント開始待ち |
| `playing` | テーブルでプレイ中 |
| `disconnected` | 切断中（2 分の猶予期間あり） |
| `eliminated` | チップ喪失で脱落。`finishPosition` 確定済み |

---

## Socket イベントフロー

### Client → Server

一覧取得は REST `GET /api/tournaments`（WebSocket ではない）。

| イベント | ペイロード | 説明 |
|---------|-----------|------|
| `tournament:register` | `{ tournamentId }` | 参加（新規登録・遅刻登録・リエントリーを統合、DB でバイイン控除） |
| `tournament:unregister` | `{ tournamentId }` | 登録解除（`registering` 中のみ） |
| `tournament:reenter` | `{ tournamentId }` | リエントリー（`eliminated` のみ、内部的には `enterPlayer` を使用） |
| `tournament:request_state` | `{ tournamentId }` | ページ遷移後のテーブル状態再送信要求 |

### Server → Client

| イベント | ペイロード | トリガー |
|---------|-----------|---------|
| `tournament:registered` | `{ tournamentId }` | 登録成功時 |
| `tournament:unregistered` | `{ tournamentId }` | 登録解除成功時 |
| `tournament:state` | `ClientTournamentState` | 状態変更時（各プレイヤーに個別送信。`myChips`/`myTableId` が異なるため） |
| `tournament:table_assigned` | `{ tableId, tournamentId }` | テーブル割り当て時 |
| `tournament:table_move` | `{ fromTableId, toTableId, reason }` | テーブル移動時 |
| `tournament:blind_change` | `{ level, nextLevel, nextLevelAt }` | ブラインドレベルアップ時 |
| `tournament:player_eliminated` | `{ odId, odName, position, playersRemaining }` | 他プレイヤー脱落（全体通知） |
| `tournament:eliminated` | `{ position, totalPlayers, prizeAmount }` | 自分の脱落（個人通知） |
| `tournament:final_table` | `{ tableId }` | ファイナルテーブル形成時 |
| `tournament:completed` | `{ results, totalPlayers, prizePool }` | トーナメント完了時 |
| `tournament:error` | `{ message }` | エラー通知 |
| `tournament:cancelled` | `{ tournamentId }` | キャンセル時 |

ゲーム中のアクション（`game:action`, `game:state`, `game:hole_cards` 等）はキャッシュゲームと共通の `TableInstance` 経由で処理される。

---

## REST API（管理者用）

| メソッド | パス | 認証 | 説明 |
|---------|------|------|------|
| `GET` | `/api/tournaments` | 不要 | 一覧取得 |
| `GET` | `/api/tournaments/:id` | 不要 | 詳細取得 |
| `POST` | `/api/tournaments` | `ADMIN_SECRET` | トーナメント作成 |
| `POST` | `/api/tournaments/:id/start` | `ADMIN_SECRET` | トーナメント開始 |
| `POST` | `/api/tournaments/:id/cancel` | `ADMIN_SECRET` | キャンセル（バイイン返還） |

---

## テーブル管理

### 初期割り当て

```
TableBalancer.initialAssignment(playerIds, playersPerTable)
  1. playerIds をシャッフル（Fisher-Yates）
  2. テーブル数 = ceil(players / playersPerTable)
  3. ラウンドロビンで均等配置
```

### テーブルバランシング

ハンド完了ごとに `checkAndExecuteBalance()` で調整（アルゴリズムの詳細は [table-balancer.md](./table-balancer.md)）。

1. **テーブル破壊**: 全プレイヤーが `(テーブル数-1) × PLAYERS_PER_TABLE` 以下なら最少テーブルを解散（非ハンド中の卓を優先して破壊対象に選ぶ）
2. **人数調整**: 縮小できないとき、最多卓と最少卓の差が 2 以上なら最多卓から 1 人移動（最多卓がハンド中ならこのラウンドはスキップ）
3. **ハンド中**: `TableBalancer.checkBalance` は移動元がハンド中の場合は空配列を返し、次回チェックまで待つ。`TournamentInstance` の `pendingMoves` は返却アクション実行時の二重ガード

### ファイナルテーブル形成

```
条件: remaining ≤ PLAYERS_PER_TABLE && tables.size > 1

処理:
  1. 新テーブル作成
  2. 全プレイヤーを旧テーブルから離席 → 新テーブルに着席
  3. 旧テーブル削除
  4. 'tournament:final_table' 送信
```

ハンド中のテーブルがある場合は `pendingFinalTable = true` で遅延し、`onHandSettled` で再試行。

---

## バスト・順位計算

### バスト検知フロー

```
TableInstance.finalizeHand()
  → チップ = 0 を検知
  → onPlayerBusted() コールバック
    └→ TournamentInstance: pendingBusts[] に蓄積（同時バスト対応）

onHandSettled()
  → チップ同期
  → finalizeBustedPlayers() で一括順位確定
  → handlePhaseTransition() でフェーズ遷移
```

### 同時バストの順位決定

同一ハンドで複数バストした場合、**ハンド開始時のチップ量**で降順ソート:

```
例: 4 人残り中 2 人バスト（チップ 800, 600）
  → 800 チップの方が 3 位（上位）
  → 600 チップの方が 4 位
  → 同チップなら同順位
```

### フェーズ遷移

```
remaining ≤ 1  → completeTournament()
remaining = 2  → status = 'heads_up'
remaining ≤ PLAYERS_PER_TABLE && tables > 1 → formFinalTable()
それ以外       → checkAndExecuteBalance()
```

---

## ブラインドスケジュール

`BlindScheduler` がタイマーでレベルを自動進行。レベルアップ時:

1. 全テーブルのブラインドを更新: `table.updateBlinds(blindsStr)`
2. 全プレイヤーに `tournament:blind_change` 送信
3. 次レベルのタイマーを設定

デフォルトスケジュール: 15 レベル（1/2 ～ 300/600、各 5〜8 分）

---

## 賞金計算

`PrizeCalculator.calculate(totalPlayers, prizePool, customPercentages)`

### デフォルト配分

| 参加者数 | 配分 |
|---------|------|
| ≤ 6 | 65%, 35% |
| ≤ 18 | 50%, 30%, 20% |
| ≤ 27 | 45%, 25%, 18%, 12% |
| > 27 | 40%, 23%, 16%, 12%, 9% |

端数は 1 位に加算（全額配分を保証）。

---

## DB スキーマ

### バイイン控除

```
tournament:register 時:
  bankroll.updateMany({ where: { balance >= buyIn }, data: { balance -= buyIn } })
  transaction.create({ type: 'TOURNAMENT_BUY_IN', amount: -buyIn })
  tournamentRegistration.upsert()
```

`updateMany` + `balance >= buyIn` 条件で**トランザクション内の残高チェック**を行い、レースコンディションを防止。

### 賞金支払い

```
completeTournament 時（onTournamentComplete コールバック経由）:
  for each result where prize > 0:
    bankroll.update({ balance += prize })
    transaction.create({ type: 'TOURNAMENT_PRIZE', amount: prize })
  tournamentResult.upsert()
  tournament.update({ status: 'COMPLETED' })
```

---

## クライアント UI フロー

### 画面遷移

```
SimpleLobby
  └→ "トーナメント" ボタン → /tournaments

TournamentLobby（一覧画面）
  ├→ "参加登録" → tournament:register
  ├→ "テーブルに入る" → /tournament/:id
  └→ "取消" → tournament:unregister

TournamentGame（ゲーム画面）
  ├── OnlineGame（skipMatchmaking=true で既存ゲーム UI を再利用）
  ├── TournamentHUD（ブラインド・残り人数・スタック情報）
  ├── TableMoveOverlay（テーブル移動中、1.5 秒表示）
  ├── EliminationOverlay（脱落時 — 順位・賞金表示）
  └── TournamentResultOverlay（完了時 — 全順位表示）
```

### OnlineGame の再利用

`OnlineGame` はキャッシュゲームとトーナメントで共用。`skipMatchmaking` prop が唯一のトーナメント固有フラグ:

- `skipMatchmaking = true`: `connect()` / `disconnect()` / `joinMatchmaking()` をスキップ（接続は `useTournamentState` が管理）
- ゲームプレイ部分（`game:state` → UI → `game:action`）は完全に共通

### オーバーレイ表示優先順位

```
elimination あり → EliminationOverlay
completedData あり → TournamentResultOverlay
isChangingTable → TableMoveOverlay
それ以外 → OnlineGame + TournamentHUD
```

---

## ボットシステム

### 構成

- **BotClient**: `tournamentMode: true` でトーナメントイベントリスナーを追加。ゲームプレイ（`handleMyTurn` → `getCPUAction`）は変更なし
- **TournamentBotManager**: N 体のボットを接続→登録→完了待ち→切断
- **tournamentBot.ts**: エントリスクリプト（トーナメント作成→登録→開始→完了の自動実行）

### 使い方

```bash
# ターミナル1: サーバー起動
cd server && npm run dev

# ターミナル2: 9 人ボットトーナメント（思考遅延なし）
cd server && BOT_COUNT=9 NO_DELAY=true npm run bot:tournament
```

### 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `SERVER_URL` | `http://localhost:3001` | サーバー URL |
| `BOT_COUNT` | `9` | ボット数 |
| `NO_DELAY` | `false` | 思考遅延ゼロ |
| `BUY_IN` | `100` | バイイン |
| `STARTING_CHIPS` | `1500` | 初期チップ |
| `BLIND_DURATION` | `0.75` | 各レベルの時間（分） |
| `TOURNAMENT_NAME` | `Bot Tournament` | トーナメント名 |

---

## 主要定数

```typescript
PLAYERS_PER_TABLE = 6
TOURNAMENT_DISCONNECT_GRACE_MS = 120000  // 2 分
DEFAULT_BUY_IN = 100
DEFAULT_STARTING_CHIPS = 1500
DEFAULT_MIN_PLAYERS = 6
DEFAULT_MAX_PLAYERS = 54  // 9 テーブル × 6 人
DEFAULT_LATE_REGISTRATION_LEVELS = 4
```

---

## 責務分担

| レイヤー | 責務 |
|---------|------|
| `TournamentInstance` | テーブル内の処理: ライフサイクル、プレイヤー管理、テーブル管理、バスト順位、フェーズ遷移 |
| `TournamentManager` | テーブルの外側の処理: 複数トーナメント管理、プレイヤートラッキング、DB 永続化 |
| `socket.ts` | DB 操作（バイイン控除/返金）+ メモリ操作の安全な連携（`withDbAndMemory`） |
| `routes.ts` | 管理 REST API（作成・開始・キャンセル） |
| `BlindScheduler` | ブラインドレベルのタイマー管理（純粋なスケジューラ） |
| `PrizeCalculator` | 賞金構造の計算（純粋関数） |
| `TableBalancer` | テーブル人数の初期配置・バランシング（純粋関数） |
| `TableInstance` | ハンド進行（キャッシュゲームと共通）。`lifecycleCallbacks` でトーナメント固有の挙動を注入 |
