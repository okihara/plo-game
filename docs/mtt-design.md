# MTT（Multi-Table Tournament）設計書

## 概要

既存のPLOキャッシュゲーム基盤の上にMTT（マルチテーブルトーナメント）を構築する設計。
`TableInstance` をコンポジションで再利用し、トーナメント管理レイヤーを追加する方針。

---

## 1. 設計方針

### TableInstance の再利用（コンポジション）

現在の `TableInstance` は以下の制約がある:
- `smallBlind`/`bigBlind` が `readonly`（ブラインドレベル変更不可）
- `handleHandComplete()` でバスト処理 + 次ハンド自動開始を行う（MTTでは外部制御が必要）

**解決策: コールバック注入パターン**

```typescript
export interface TableCallbacks {
  onHandComplete?: (tableId: string, gameState: GameState, seats: (SeatInfo | null)[]) => void;
  onPlayerBusted?: (tableId: string, odId: string, seatIndex: number) => void;
  onPlayerCountChanged?: (tableId: string, playerCount: number) => void;
}
```

- コンストラクタに `callbacks?: TableCallbacks` を追加
- `callbacks` 未指定時は既存の動作を維持（キャッシュゲームに影響なし）
- MTTモードでは `TournamentInstance` がコールバック経由でバスト処理・テーブルバランシングを制御

### TableInstance への必要な修正

| 変更内容 | 詳細 |
|---------|------|
| `readonly` 解除 | `smallBlind`/`bigBlind` を変更可能にする |
| `updateBlinds(sb, bb)` | ブラインドレベル更新メソッド追加 |
| `reconnectPlayer(odId, socket)` | 切断復帰用メソッド追加 |
| `getPlayerChips(odId)` | テーブル移動時のチップ取得用 |
| `handleHandComplete()` L539-547 | バスト処理をコールバックに委譲可能にする |

---

## 2. サーバー側アーキテクチャ

### 新規モジュール構成

```
server/src/modules/tournament/
├── types.ts                    # 型定義
├── constants.ts                # ブラインドスケジュール、デフォルト設定
├── TournamentManager.ts        # 全トーナメントのレジストリ
├── TournamentInstance.ts       # 1トーナメントのライフサイクル管理（核）
├── TableBalancer.ts            # テーブル間プレイヤー移動アルゴリズム
├── BlindScheduler.ts           # タイマーベースのブラインドレベル管理
├── PrizeCalculator.ts          # 賞金配分計算
└── socket.ts                   # トーナメント用Socket.ioイベントハンドラ
```

### 各モジュールの責務

#### TournamentManager
- `tournaments: Map<string, TournamentInstance>` - 全トーナメントのレジストリ
- `playerTournaments: Map<string, string>` - プレイヤー → トーナメントID のマッピング
- トーナメント作成/取得/一覧/クリーンアップ

#### TournamentInstance（核）
- 1つのトーナメントの全ライフサイクルを管理
- 内部に複数の `TableInstance` を保持
- 登録 → テーブル割り当て → ハンド進行 → バスト処理 → テーブルバランシング → ファイナルテーブル → 完了

#### TableBalancer
- 初期テーブル割り当て（ランダムシャッフル → 均等分配）
- ハンド完了ごとのバランスチェック
- テーブル破壊判定（残り人数で1テーブル減らせるか）
- プレイヤー移動指示の生成

#### BlindScheduler
- タイマーベースでブラインドレベルを管理
- `start(onLevelUp)` で開始、各レベルの `durationMinutes` 経過後にコールバック発火
- `stop()` でタイマー停止

#### PrizeCalculator
- プレイヤー数に応じた賞金構造の決定
- 順位ごとの賞金額計算

---

## 3. 型定義

### トーナメントステータス

```
registering → starting → running → final_table → heads_up → completed
                                                              ↗
                                      (cancelled) ←──────────
```

### 主要な型

```typescript
type TournamentStatus =
  | 'registering' | 'starting' | 'running'
  | 'final_table' | 'heads_up' | 'completed' | 'cancelled';

interface BlindLevel {
  level: number;           // 1, 2, 3, ...
  smallBlind: number;
  bigBlind: number;
  ante: number;            // 将来対応（当面は0）
  durationMinutes: number; // このレベルの継続時間
}

interface TournamentConfig {
  id: string;
  name: string;
  buyIn: number;                       // 参加費
  startingChips: number;               // 初期チップ
  minPlayers: number;                  // 最小参加者数（デフォルト6）
  maxPlayers: number;                  // 最大参加者数（デフォルト54 = 9テーブル × 6）
  playersPerTable: number;             // テーブルあたり最大人数（6）
  blindSchedule: BlindLevel[];
  lateRegistrationLevels: number;      // レベルN終了まで遅刻登録可能
  payoutPercentage: number[];          // 例: [50, 30, 20]
  startCondition: 'manual' | 'player_count' | 'scheduled';
  scheduledStartTime?: Date;
  requiredPlayerCount?: number;
  allowReentry: boolean;
  maxReentries: number;
  reentryDeadlineLevel: number;
}

interface TournamentPlayer {
  odId: string;
  odName: string;
  avatarUrl: string | null;
  socket: Socket | null;
  chips: number;
  tableId: string | null;
  seatIndex: number | null;
  status: 'registered' | 'playing' | 'eliminated' | 'disconnected';
  finishPosition: number | null;
  reentryCount: number;
  registeredAt: Date;
  eliminatedAt: Date | null;
}

// クライアントに送信するトーナメント状態
interface ClientTournamentState {
  tournamentId: string;
  name: string;
  status: TournamentStatus;
  buyIn: number;
  startingChips: number;
  prizePool: number;
  totalPlayers: number;
  playersRemaining: number;
  currentBlindLevel: BlindLevel;
  nextBlindLevel: BlindLevel | null;
  nextLevelAt: number;                 // UNIXタイムスタンプ
  myChips: number | null;
  myTableId: string | null;
  averageStack: number;
  largestStack: number;
  smallestStack: number;
  payoutStructure: { position: number; amount: number }[];
  isLateRegistrationOpen: boolean;
  isFinalTable: boolean;
}

// ロビー用の簡易情報
interface TournamentLobbyInfo {
  id: string;
  name: string;
  status: TournamentStatus;
  buyIn: number;
  startingChips: number;
  registeredPlayers: number;
  maxPlayers: number;
  currentBlindLevel: number;
  prizePool: number;
  scheduledStartTime?: Date;
  isLateRegistrationOpen: boolean;
}
```

---

## 4. デフォルトブラインドスケジュール

| レベル | SB | BB | 時間 |
|--------|-----|------|------|
| 1 | 1 | 2 | 8分 |
| 2 | 2 | 4 | 8分 |
| 3 | 3 | 6 | 8分 |
| 4 | 5 | 10 | 8分 |
| 5 | 8 | 16 | 8分 |
| 6 | 10 | 20 | 8分 |
| 7 | 15 | 30 | 6分 |
| 8 | 20 | 40 | 6分 |
| 9 | 30 | 60 | 6分 |
| 10 | 50 | 100 | 6分 |
| 11 | 75 | 150 | 5分 |
| 12 | 100 | 200 | 5分 |
| 13 | 150 | 300 | 5分 |
| 14 | 200 | 400 | 5分 |
| 15 | 300 | 600 | 5分 |

デフォルト初期チップ: 1,500

---

## 5. TournamentInstance 主要ロジック

### トーナメント開始フロー

```
1. registerPlayer() でプレイヤーを収集
2. start() 呼び出し:
   a. TableBalancer.initialAssignment() でプレイヤーをシャッフル・均等分配
   b. 各テーブルに対して TableInstance を callbacks 付きで生成
   c. 各テーブルに seatPlayer() でプレイヤーを着席
   d. BlindScheduler.start() でブラインドタイマー開始
   e. 各テーブルが自動的にハンドを開始
```

### ブラインド変更タイミング

`updateBlinds()` はプロパティを更新するだけ。`startNewHand()` が次ハンド開始時に `this.smallBlind/bigBlind` を参照するため、**自然にハンド間で適用される**（ハンド中のブラインド変更は起きない）。

### プレイヤーバスト処理

```
TableInstance.handleHandComplete()
  → callbacks.onPlayerBusted(tableId, odId, seatIndex)
    → TournamentInstance.onPlayerBusted():
      1. プレイヤーのstatusを'eliminated'に変更
      2. finishPosition = 残りプレイヤー数 + 1
      3. 排除通知（個人 + 全体ブロードキャスト）
      4. checkTableBalance() でテーブル再配置判定
      5. 残り1人 → completeTournament()
         残り6人以下 → formFinalTable()
         残り2人 → status = 'heads_up'
```

### テーブルバランシングアルゴリズム

```
checkTableBalance():
  1. テーブルが1つなら何もしない
  2. 全プレイヤー数 ≤ (テーブル数-1) × 6 → 最少テーブルを破壊
     - 破壊テーブルの全プレイヤーを他テーブルに移動
  3. テーブル間のプレイヤー差 ≥ 2 → 多いテーブルから少ないテーブルへ移動
  4. 移動はハンド完了後のみ実行（ハンド中は移動しない）
```

### プレイヤー移動フロー

```
movePlayer(odId, fromTableId, toTableId):
  1. player.socket に tournament:table_move 送信
  2. fromTable.unseatPlayer() で離席（現在のチップ数を記録）
  3. toTable.seatPlayer() で着席（記録したチップ数で）
  4. Socket.ioルーム変更（leave old room, join new room）
  5. tournament:table_assigned 送信
```

### 切断/再接続

- キャッシュゲーム: 30秒の猶予
- MTT: **2分の猶予**（トーナメントの方が重要度が高い）
- 切断中もアクションタイマーは動作 → 自動フォールド
- チップがなくなるまでブラインドを払い続ける
- 再接続時: `reconnectPlayer()` でSocket更新 + 状態再送信

---

## 6. データベーススキーマ追加

### 新規モデル

```prisma
model Tournament {
  id                     String           @id @default(cuid())
  name                   String
  status                 TournamentStatus @default(REGISTERING)
  buyIn                  Int
  startingChips          Int
  minPlayers             Int              @default(6)
  maxPlayers             Int              @default(54)
  blindSchedule          Json             // BlindLevel[]
  prizePool              Int              @default(0)
  lateRegistrationLevels Int              @default(4)
  payoutPercentage       Json             @default("[50, 30, 20]")
  allowReentry           Boolean          @default(false)
  scheduledStartTime     DateTime?
  startedAt              DateTime?
  completedAt            DateTime?
  createdAt              DateTime         @default(now())
  registrations          TournamentRegistration[]
  results                TournamentResult[]
  @@index([status])
  @@index([scheduledStartTime])
  @@index([createdAt])
}

enum TournamentStatus {
  REGISTERING
  STARTING
  RUNNING
  FINAL_TABLE
  HEADS_UP
  COMPLETED
  CANCELLED
}

model TournamentRegistration {
  id           String   @id @default(cuid())
  tournamentId String
  userId       String
  registeredAt DateTime @default(now())
  reentryCount Int      @default(0)
  tournament   Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([tournamentId, userId])
  @@index([userId])
  @@index([tournamentId])
}

model TournamentResult {
  id           String   @id @default(cuid())
  tournamentId String
  userId       String
  position     Int
  prize        Int      @default(0)
  reentries    Int      @default(0)
  createdAt    DateTime @default(now())
  tournament   Tournament @relation(fields: [tournamentId], references: [id], onDelete: Cascade)
  user         User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([tournamentId, userId])
  @@index([userId])
  @@index([tournamentId])
}
```

### 既存モデルへの変更

- `TransactionType` に `TOURNAMENT_BUY_IN`, `TOURNAMENT_PRIZE` 追加
- `HandHistory` に `tournamentId String?` 追加（NULLならキャッシュゲーム）
- `User` に `tournamentRegistrations`, `tournamentResults` リレーション追加

---

## 7. Socket.io イベント設計

### Client → Server（新規）

| イベント | ペイロード | 説明 |
|---------|-----------|------|
| `tournament:list` | なし | トーナメント一覧取得 |
| `tournament:register` | `{ tournamentId }` | 参加登録 |
| `tournament:unregister` | `{ tournamentId }` | 登録解除 |
| `tournament:reenter` | `{ tournamentId }` | リエントリー |

### Server → Client（新規）

| イベント | ペイロード | 説明 |
|---------|-----------|------|
| `tournament:list` | `{ tournaments: TournamentLobbyInfo[] }` | 一覧応答 |
| `tournament:registered` | `{ tournamentId }` | 登録完了 |
| `tournament:unregistered` | `{ tournamentId }` | 登録解除完了 |
| `tournament:state` | `ClientTournamentState` | トーナメント状態更新 |
| `tournament:table_assigned` | `{ tableId, tournamentId }` | テーブル割り当て通知 |
| `tournament:table_move` | `{ fromTableId, toTableId, reason }` | テーブル移動開始 |
| `tournament:blind_change` | `{ level, nextLevel, nextLevelAt }` | ブラインド変更 |
| `tournament:player_eliminated` | `{ odId, odName, position, playersRemaining }` | 排除通知（全体） |
| `tournament:eliminated` | `{ position, totalPlayers, prizeAmount }` | 排除通知（個人） |
| `tournament:final_table` | `{ tableId }` | ファイナルテーブル形成 |
| `tournament:completed` | `{ results[], totalPlayers, prizePool }` | 完了・結果 |
| `tournament:error` | `{ message }` | エラー |

### 既存イベントとの共存

ゲーム進行中のイベント（`game:state`, `game:hole_cards`, `game:action_required` 等）は**そのまま流用**。
`TableInstance` が `table:${tableId}` ルームにブロードキャストし、トーナメントプレイヤーもそのルームに属するため追加対応不要。
トーナメント固有イベントは `tournament:${tournamentId}` ルームで分離。

---

## 8. クライアント側アーキテクチャ

### 新規ファイル

```
src/
├── pages/
│   ├── TournamentLobby.tsx      # 一覧・登録画面
│   └── TournamentGame.tsx       # ゲーム画面（OnlineGameベース）
├── components/
│   ├── TournamentHUD.tsx        # ブラインドLv・残り人数・平均スタック
│   ├── TableMoveOverlay.tsx     # テーブル移動演出
│   └── EliminationOverlay.tsx   # 排除時の結果表示
├── hooks/
│   └── useTournamentState.ts    # トーナメント状態管理
```

### TournamentHUD 表示内容

```
┌──────────────────────────────┐
│ [Lv.3] 3/6  次レベル 5:23    │ ← ブラインドレベル・カウントダウン
│ 残り 18人  平均 4,500         │ ← プレイヤー数・平均スタック
│ 賞金 18,000                   │ ← プライズプール
└──────────────────────────────┘
```

### ルーティング（main.tsx に追加）

```
/tournaments          → TournamentLobby
/tournament/:id       → TournamentGame
```

### テーブル移動演出

既存の `isChangingTable`（ファストフォールドのテーブル切替演出、OnlineGame.tsx L260-266）のパターンを流用。

---

## 9. 賞金配分

プレイヤー数に応じた賞金構造:

| プレイヤー数 | 入賞枠 | 配分 |
|------------|--------|------|
| 6人以下 | 上位2人 | 65% / 35% |
| 7-18人 | 上位3人 | 50% / 30% / 20% |
| 19-27人 | 上位4人 | 45% / 25% / 18% / 12% |
| 28人以上 | 上位5人 | 40% / 23% / 16% / 12% / 9% |

---

## 10. 既知の課題と対策

### テーブル移動中のハンド
**問題**: 移動対象のプレイヤーがハンド中の場合
**対策**: ハンド完了を待ってから移動。ペンディング移動キューを `TournamentInstance` に持つ。

### ヘッズアップ（2人プレイ）
既存の `gameEngine.ts` の `startNewHand()` はヘッズアップ対応済み（BTN=SBの特殊ルール）。追加対応不要。

### MAX_PLAYERS=6 の制約
`gameEngine.ts` の各関数が `% 6` をハードコーディング。当面は6人テーブル固定。将来9人テーブル対応時には定数化が必要。

### スケーラビリティ
当面は同時1-2トーナメント、最大54人（9テーブル）を想定。`TableInstance` のメモリフットプリントは小さいため問題なし。

---

## 11. 実装フェーズ

### Phase 1: 基盤
- 型定義・定数
- TableInstance 修正（callbacks, updateBlinds, reconnectPlayer）
- PrizeCalculator, BlindScheduler（独立テスト可能）
- Prisma スキーマ更新 + マイグレーション

### Phase 2: コアロジック
- TableBalancer
- TournamentInstance（登録→開始→進行→完了）
- TournamentManager
- Socket.ioイベントハンドラ、index.ts 統合

### Phase 3: クライアントUI
- TournamentLobby + ルーティング
- useTournamentState
- TournamentGame + TournamentHUD
- テーブル移動・排除・結果の各オーバーレイ

### Phase 4: 仕上げ
- 切断/再接続テスト
- 遅刻登録・リエントリー
- 管理ダッシュボードにトーナメント情報追加
