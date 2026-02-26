# PLO ポーカーゲーム アーキテクチャ再設計案

> 現在のコードベースを分析し、ゼロから再設計するとしたらどうするかをまとめた設計文書。

## 目次

1. [現状の課題](#現状の課題)
2. [モノレポ構成](#1-pnpm-workspaces-モノレポ)
3. [ゲームエンジン: 純粋ステートマシン](#2-ゲームエンジンを純粋なステートマシンに)
4. [サーバー: Actor パターン](#3-サーバー-actor-パターンでテーブルを管理)
5. [フロントエンド: 状態分割](#4-フロントエンド-状態を分割し薄い-hook-に)
6. [WebSocket プロトコル型安全性](#5-websocket-プロトコルの型安全性)
7. [テスタビリティ設計](#6-テスタビリティの設計)
8. [FastFold ステートマシン](#7-fastfold-をステートマシンに)
9. [データベース設計改善](#8-データベース設計の改善)
10. [設計原則対比表](#まとめ-設計原則の対比)

---

## 現状の課題

コードベース分析で見えた構造的問題:

| 課題 | 具体例 |
|------|--------|
| **God Class** | `TableInstance.ts` 838行、8つのヘルパーを抱える |
| **共有ロジックの重複** | `handEvaluator.ts`, `deck.ts` がclient/serverに別々に存在 |
| **巨大Hook** | `useOnlineGameState.ts` 510行、13イベントリスナー、12+ state変数 |
| **レースコンディション** | テーブルアクションにmutex/queueなし |
| **非効率なimmutability** | `JSON.parse(JSON.stringify(state))` が6箇所以上 |
| **散在するタイマー管理** | 4種類のタイマーが複数クラスにまたがる |
| **テスト不足** | テストファイル4つのみ、TableInstanceのテストなし |

---

## 1. pnpm Workspaces モノレポ

最大の構造的問題は共有コードの重複。モノレポで根本解決する。

```
plo-game/
├── packages/
│   ├── shared/                 # 共有パッケージ (@plo/shared)
│   │   ├── src/
│   │   │   ├── types.ts        # Card, Player, GameState 等の型
│   │   │   ├── engine/
│   │   │   │   ├── stateMachine.ts   # ゲーム状態遷移（純粋関数）
│   │   │   │   ├── actions.ts        # アクション適用ロジック
│   │   │   │   ├── potCalculator.ts  # ポット・サイドポット計算
│   │   │   │   ├── validations.ts    # アクションバリデーション
│   │   │   │   └── winnerResolver.ts # ショーダウン判定
│   │   │   ├── evaluator/
│   │   │   │   ├── handEvaluator.ts  # PLOハンド評価
│   │   │   │   └── equityCalc.ts     # エクイティ計算
│   │   │   ├── deck.ts
│   │   │   └── protocol.ts    # WebSocketイベント型定義
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── table/          # テーブル管理（後述）
│   │   │   ├── auth/
│   │   │   ├── history/
│   │   │   ├── stats/
│   │   │   └── bot/
│   │   └── package.json        # depends on @plo/shared
│   │
│   └── client/
│       ├── src/
│       │   ├── stores/         # 状態管理（後述）
│       │   ├── pages/
│       │   ├── components/
│       │   └── services/
│       └── package.json        # depends on @plo/shared
│
├── pnpm-workspace.yaml
└── package.json
```

**効果**: `handEvaluator.ts` や types 等の重複が完全に消える。型変更が一箇所で済む。

---

## 2. ゲームエンジンを純粋なステートマシンに

現在の `gameEngine.ts` は純粋関数を目指しているが、`JSON.parse/stringify` による深いコピーや、責務の混在がある。明確なステートマシンとして再設計する。

```typescript
// packages/shared/src/engine/stateMachine.ts

// ゲームのフェーズを明確に型で表現
type HandPhase =
  | { type: 'waiting' }
  | { type: 'dealing' }
  | { type: 'betting'; street: Street }
  | { type: 'showdown' }
  | { type: 'complete'; results: HandResult[] }

// コマンド（入力）とイベント（出力）を分離
type GameCommand =
  | { type: 'START_HAND' }
  | { type: 'PLAYER_ACTION'; seatIndex: number; action: Action; amount?: number }
  | { type: 'PLAYER_FOLD'; seatIndex: number }
  | { type: 'TIMEOUT'; seatIndex: number }

type GameEvent =
  | { type: 'HAND_STARTED'; dealerSeat: number; cards: Map<number, Card[]> }
  | { type: 'ACTION_APPLIED'; seatIndex: number; action: Action; amount: number }
  | { type: 'STREET_CHANGED'; street: Street; communityCards: Card[] }
  | { type: 'SHOWDOWN'; results: ShowdownResult[] }
  | { type: 'HAND_COMPLETED'; winners: Winner[]; potDistribution: PotDistribution }

// エンジンは純粋関数: (State, Command) → (State, Event[])
function processCommand(
  state: GameState,
  command: GameCommand
): { state: GameState; events: GameEvent[] } {
  // Immer で効率的な不変更新
  // バリデーション → 状態遷移 → イベント生成
}
```

**現状との違い**:
- `JSON.parse/stringify` → **Immer** による構造共有で効率的
- 状態遷移とI/Oが混在 → **純粋関数**が状態とイベントだけ返す
- 暗黙的な副作用 → イベントとして明示的に返す

---

## 3. サーバー: Actor パターンでテーブルを管理

現在の `TableInstance` が838行の God Class になっている根本原因は、ゲームロジック・I/O・タイマー管理・スペクテーター管理が混在していること。**Actor パターン**で分離する。

```typescript
// server/src/table/TableActor.ts

class TableActor {
  private state: GameState
  private engine: GameEngine        // 純粋関数を呼ぶだけ
  private queue: AsyncQueue         // アクションの直列化 → レースコンディション解消
  private scheduler: TimerScheduler // タイマー一元管理
  private broadcaster: Broadcaster  // Socket.io配信

  // 全ての外部入力はキューを通る
  async enqueue(command: GameCommand): Promise<void> {
    await this.queue.push(async () => {
      // 1. 純粋関数でステート遷移
      const { state, events } = processCommand(this.state, command)
      this.state = state

      // 2. イベントに応じた副作用を実行
      for (const event of events) {
        await this.handleEvent(event)
      }
    })
  }

  // イベントハンドラ: I/O副作用はここだけ
  private async handleEvent(event: GameEvent): Promise<void> {
    switch (event.type) {
      case 'HAND_STARTED':
        this.broadcaster.sendHoleCards(event.cards)
        this.broadcaster.broadcastState(this.state)
        this.scheduler.setActionTimeout(
          this.state.currentPlayer, ACTION_TIMEOUT_MS
        )
        break
      case 'STREET_CHANGED':
        this.scheduler.setDelay('street_transition', STREET_DELAY_MS, () =>
          this.enqueue({ type: 'RESUME_AFTER_DELAY' })
        )
        break
      case 'HAND_COMPLETED':
        this.broadcaster.broadcastHandComplete(event)
        // fire-and-forget
        this.historyRecorder.record(this.state, event).catch(console.error)
        break
    }
  }
}
```

### TimerScheduler: タイマー一元管理

現在4種類のタイマーが散在している問題を解消する。

```typescript
// server/src/table/TimerScheduler.ts

class TimerScheduler {
  private timers = new Map<string, NodeJS.Timeout>()

  set(key: string, ms: number, callback: () => void): void {
    this.clear(key)
    this.timers.set(key, setTimeout(callback, ms))
  }

  clear(key: string): void {
    const timer = this.timers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(key)
    }
  }

  clearAll(): void {
    this.timers.forEach(t => clearTimeout(t))
    this.timers.clear()
  }
}
```

**キューの効果**: 現在の最大の懸念である「2つのアクションが同時に `handleAction()` に入る」問題が構造的に消滅する。

---

## 4. フロントエンド: 状態を分割し、薄い Hook に

現在の `useOnlineGameState` は510行で、接続管理・ゲーム状態・UI演出・タイマーが全部入り。**Zustand** で責務ごとにストアを分割する。

```typescript
// client/src/stores/connectionStore.ts
const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',  // 'connecting' | 'connected' | 'disconnected'
  playerId: null,
  error: null,
  connect: () => { /* ... */ },
  disconnect: () => { /* ... */ },
}))

// client/src/stores/gameStore.ts
const useGameStore = create<GameStoreState>((set, get) => ({
  tableId: null,
  gameState: null,
  myHoleCards: [],
  mySeat: -1,
  validActions: [],

  // サーバーイベントに対応するアクション
  onGameState: (clientState: ClientGameState) => { /* ... */ },
  onHoleCards: (cards: Card[]) => { /* ... */ },
  onShowdown: (data: ShowdownData) => { /* ... */ },
  onHandComplete: (data: HandCompleteData) => { /* ... */ },

  // computed（Zustand の subscribe + selector）
  get activePlayers() { /* derived */ },
  get currentStreet() { /* derived */ },
}))

// client/src/stores/animationStore.ts
const useAnimationStore = create<AnimationState>((set) => ({
  isDealingCards: false,
  showdownCards: new Map(),
  lastActions: new Map(),
  // タイマー管理もここに集約
}))
```

**Hook は薄いグルーに**:

```typescript
// client/src/hooks/useSocketEvents.ts
// WebSocket リスナーの登録/解除だけ。ロジックはストアに委譲
function useSocketEvents() {
  const gameStore = useGameStore()
  const animStore = useAnimationStore()

  useEffect(() => {
    wsService.on('game:state', gameStore.onGameState)
    wsService.on('game:hole_cards', gameStore.onHoleCards)
    wsService.on('game:showdown', animStore.onShowdown)
    // ...
    return () => wsService.offAll()
  }, [])
}
```

---

## 5. WebSocket プロトコルの型安全性

現在も型はあるが、client/server で別管理。共有パッケージで一元化する。

```typescript
// packages/shared/src/protocol.ts

// サーバー → クライアント
interface ServerEvents {
  'game:state': (data: {
    state: ClientGameState
    timeout?: TimeoutInfo
  }) => void
  'game:hole_cards': (data: { cards: Card[] }) => void
  'game:showdown': (data: ShowdownData) => void
  'game:hand_complete': (data: HandCompleteData) => void
  // ...
}

// クライアント → サーバー
interface ClientEvents {
  'game:action': (data: { action: Action; amount?: number }) => void
  'game:fast_fold': () => void
  'matchmaking:join': (data: {
    blinds: number
    isFastFold: boolean
  }) => void
  // ...
}

// Socket.io の型パラメータとして使用
// server: io<ClientEvents, ServerEvents>
// client: socket<ServerEvents, ClientEvents>
// → 型の不一致がコンパイル時に検出される
```

---

## 6. テスタビリティの設計

現在テストが少ない最大の理由は、テストしにくい構造。設計段階でテスタビリティを組み込む。

### テスト戦略

```
1. GameEngine (packages/shared)
   - 純粋関数なのでユニットテストが容易
   - processCommand() に状態とコマンドを渡すだけ
   - 例: "3人がオールインした場合のサイドポット計算"

2. TableActor (server)
   - Broadcaster / Scheduler を mock 注入
   - enqueue() でコマンドを送り、mock の呼び出しを検証
   - 例: "タイムアウト後に自動フォールドされること"

3. Stores (client)
   - Zustand は React 外でもテスト可能
   - useGameStore.getState().onGameState(mockData) で直接テスト
   - UI レンダリング不要

4. 統合テスト
   - in-memory Socket.io でクライアント ↔ サーバー接続
   - 1ハンドの完全フローを自動実行
```

**現状の TableInstance がテストしにくい理由**: コンストラクタで8つのヘルパーを生成し、Socket.io に直接依存している。Actor パターンでは依存を注入するので、mock が容易。

---

## 7. FastFold をステートマシンに

現在の FastFold はコールバックベースで、プレイヤーが複数の状態を行き来する複雑なロジック。明示的なステートマシンに。

```typescript
type PlayerLifecycle =
  | { status: 'queued' }                              // マッチメイキング待ち
  | { status: 'seated'; tableId: string }              // テーブルに着席
  | { status: 'playing'; tableId: string }             // ハンド参加中
  | { status: 'folded_waiting'; tableId: string }      // FFフォールド、再配置待ち
  | { status: 'transitioning'; from: string; to: string }  // テーブル移動中
  | { status: 'disconnected'; graceUntil: number }     // 切断、猶予中

// 遷移を明示的に定義
function transition(
  current: PlayerLifecycle,
  event: LifecycleEvent
): PlayerLifecycle {
  // 不正な遷移はコンパイル時 or ランタイムで弾く
}
```

---

## 8. データベース設計の改善

```
現状: actions が JSON 列 → クエリ不可
改善: イベントソーシング的にアクションテーブルを正規化
```

### HandAction テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| `id` | PK | |
| `handId` | FK → Hand | |
| `sequence` | INT | アクション順序 |
| `street` | ENUM | preflop/flop/turn/river |
| `seatIndex` | INT | 座席番号 |
| `action` | ENUM | fold/check/call/bet/raise |
| `amount` | INT | ベット額 |
| `timestamp` | DATETIME | |

**効果**:
- `3bet の頻度` 等を SQL で直接集計可能
- `computeStats.ts` の1000ハンドメモリ読み込みが不要に
- ストリーミング集計やマテリアライズドビューが使える

---

## まとめ: 設計原則の対比

| 観点 | 現状 | 再設計 |
|------|------|--------|
| **コード共有** | ファイルコピー | pnpm workspace モノレポ |
| **ゲームエンジン** | 純粋関数風だが JSON.parse | Immer + 明示的ステートマシン |
| **テーブル管理** | God Class 838行 | Actor + AsyncQueue |
| **レースコンディション** | 暗黙的に問題なしと仮定 | キューで構造的に排除 |
| **タイマー** | 4種が散在 | TimerScheduler に一元化 |
| **フロントエンド状態** | 1 Hook 510行 | Zustand ストア分割 |
| **WebSocket 型** | client/server 別定義 | 共有パッケージで一元化 |
| **テスト** | 4ファイル | 純粋関数 + DI で全層テスト可能 |
| **FastFold** | コールバック + フラグ | 明示的ステートマシン |
| **DB 集計** | JSON 列 + メモリ集計 | 正規化テーブル + SQL 集計 |

---

## 設計の核心

**Functional Core / Imperative Shell パターン**

```
┌─────────────────────────────────────────┐
│  Imperative Shell (I/O, 副作用)          │
│  ┌───────────────────────────────────┐  │
│  │  Functional Core (純粋関数)        │  │
│  │  - GameEngine                     │  │
│  │  - HandEvaluator                  │  │
│  │  - PotCalculator                  │  │
│  │  - ActionValidator                │  │
│  └───────────────────────────────────┘  │
│  - TableActor (キュー + 副作用実行)      │
│  - Broadcaster (Socket.io 配信)         │
│  - TimerScheduler (タイムアウト管理)     │
│  - HistoryRecorder (DB 書き込み)        │
└─────────────────────────────────────────┘
```

ゲームロジックを完全に純粋にし、I/O をその外側に押し出す。現状のコードはこの方向を目指しているが、TableInstance に副作用が染み込んでいる。ゼロからならこの境界を最初から厳格に守る。
