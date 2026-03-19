# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PLOポーカーゲーム - スマートフォン向けPot Limit Omaha実装。

- **オンラインモード**: リアルタイムマルチプレイヤー

## Development Commands

### フロントエンド (クライアント)

```bash
npm install      # 依存関係インストール
npm run dev      # 開発サーバー起動 (localhost:5173)
npm run build    # TypeScriptチェック + 本番ビルド
npm run preview  # 本番ビルドのプレビュー
```

### バックエンド (サーバー)

```bash
# 初回セットアップ
docker-compose up -d              # PostgreSQL起動
cd server && npm install          # 依存関係インストール
npm run db:push                   # データベーススキーマ反映

# 開発
cd server && npm run dev          # サーバー起動 (localhost:3001)

# TypeScriptチェック
cd server && npx tsc --noEmit

# テスト
cd server && npm test             # 全テスト実行 (vitest)
cd server && npm run test:watch   # ウォッチモード
```

### 全体起動 (2ターミナル必要)

```bash
# ターミナル1: フロントエンド
npm run dev

# ターミナル2: バックエンド
npm run dev:server
```

## Tech Stack

### フロントエンド
- React 18 + TypeScript
- Vite (ビルドツール)
- Tailwind CSS（コンテナクエリ単位 `cqw` を多用）
- Socket.io-client (WebSocket)
- カスタムルーティング（React Router不使用、`window.history.pushState` + `popstate`）

### バックエンド
- Fastify + TypeScript
- Socket.io (リアルタイム通信)
- PostgreSQL + Prisma (データベース)
- JWT認証（httpOnly Cookie）+ Twitter OAuth 1.0a

### インフラ
- Docker Compose (PostgreSQL)
- Railway (本番デプロイ)

## Architecture

### 共有パッケージ構成（@plo/shared）

フロントエンド・サーバー双方から参照される共有ロジック。

```
packages/shared/src/
├── index.ts              # re-export
├── types.ts              # 共有型定義（GameState, Player, Card, Rank, Suit等）
├── deck.ts               # カード操作（getRankValue等）
├── handEvaluator.ts      # PLOハンド評価（ホール2枚+コミュニティ3枚）
├── preflopEquity.ts      # プリフロップ評価（エクイティ+プレイアビリティ）
├── protocol.ts           # WebSocket通信プロトコル
└── data/
    └── preflopEquity.json # 事前計算済みエクイティデータ（16,432ハンド）
```

### フロントエンド構成

```
src/
├── main.tsx                      # ルーティング（パスベース、React Router不使用）
├── pages/
│   ├── SimpleLobby.tsx           # ロビー（ブラインド選択・ログイン）
│   ├── OnlineGame.tsx            # メインゲーム画面
│   ├── HandHistory.tsx           # ハンド履歴閲覧 (/history)
│   └── PlayerDebug.tsx           # デバッグ (/debug/player)
├── components/
│   ├── PokerTable.tsx            # テーブル（楕円形、6人配置）
│   ├── Player.tsx                # 個別プレイヤー（アバター・カード・タイマー）
│   ├── MyCards.tsx               # 自分のホールカード（画面下部、h-[24cqw]）
│   ├── ActionPanel.tsx           # ベッティングコントロール（フォールド/コール/レイズ）
│   ├── CommunityCards.tsx        # コミュニティカード5枚（テーブル中央）
│   ├── Card.tsx                  # カード表示（Card + FaceDownCard）
│   ├── ResultOverlay.tsx         # ハンド結果表示
│   ├── HandAnalysisOverlay.tsx   # ハンド分析表示
│   └── ProfilePopup.tsx          # プレイヤースタッツポップアップ
├── hooks/
│   └── useOnlineGameState.ts     # WebSocket + ゲーム状態管理（プレイヤー用）
├── services/
│   └── websocket.ts              # WebSocket接続シングルトン（wsService）
├── logic/
│   ├── types.ts                  # ゲーム型定義（GameState, Player, Card等）
│   ├── gameEngine.ts             # ゲームエンジン（状態管理・ハンド進行）
│   ├── handEvaluator.ts          # PLOハンド評価（ホール2枚+コミュニティ3枚）
│   └── deck.ts                   # カード操作
└── contexts/
    ├── AuthContext.tsx            # 認証（Twitter OAuth、/api/auth/me）
    └── GameSettingsContext.tsx    # 設定（BB表記、チップフォーマット）
```

### サーバー構成

```
server/src/
├── index.ts                      # エントリーポイント（Fastify + Socket.io + 静的配信）
├── config/
│   ├── env.ts                    # 環境変数
│   └── database.ts               # Prismaクライアント
├── modules/
│   ├── game/
│   │   ├── socket.ts             # エントリーポイント（socket.on登録、テーブル初期化）
│   │   ├── authMiddleware.ts     # 認証ミドルウェア（JWT/Bot認証、findOrCreateBotUser）
│   │   ├── fastFoldService.ts    # FastFoldロジック（テーブル移動・再割り当て）
│   │   └── handlers.ts           # イベントハンドラ実装（DB・TableManager操作）
│   ├── table/
│   │   ├── TableManager.ts       # テーブルレジストリ（tables Map、playerTables Map）
│   │   ├── TableInstance.ts      # テーブル実装（ゲーム状態・ハンド進行・スペクテーター）
│   │   ├── constants.ts          # 定数（MAX_PLAYERS=6, ACTION_TIMEOUT_MS=10000等）
│   │   ├── types.ts              # テーブル型定義
│   │   └── helpers/
│   │       ├── PlayerManager.ts      # 座席管理（SeatInfo[6]）
│   │       ├── BroadcastService.ts   # Socket.ioルーム配信（table:${id}）
│   │       ├── ActionController.ts   # アクション処理 + タイムアウト
│   │       ├── FoldProcessor.ts      # フォールド処理
│   │       ├── StateTransformer.ts   # GameState → ClientGameState変換
│   │       ├── HandHistoryRecorder.ts # ハンド履歴DB保存（fire-and-forget）
│   │       └── AdminHelper.ts       # 管理・デバッグ機能
│   ├── fastfold/
│   │   └── MatchmakingPool.ts    # FFマッチメイキング（500ms間隔キュー処理）
│   ├── auth/
│   │   ├── routes.ts             # Twitter OAuth + JWT認証
│   │   └── bankroll.ts           # バンクロール管理
│   ├── admin/
│   │   └── routes.ts             # 管理ダッシュボード（/admin/status）
│   ├── history/
│   │   └── routes.ts             # ハンド履歴API
│   └── stats/
│       ├── routes.ts             # スタッツAPI（60秒キャッシュ）
│       └── computeStats.ts       # VPIP/PFR/3Bet等の集計計算
└── shared/
    ├── logic/
    │   ├── types.ts              # 共有型（GameState, Player, Card）
    │   ├── gameEngine.ts         # 共有ゲームロジック
    │   ├── cpuAI.ts              # Bot AIエントリーポイント（getCPUAction）
    │   ├── preflopEquity.ts      # @plo/shared からの re-export
    │   └── ai/
    │       ├── types.ts          # AI型定義（BotPersonality, OpponentModel等）
    │       ├── preflopStrategy.ts # プリフロップ戦略（オープン/ディフェンス/3bet/4bet）
    │       ├── postflopStrategy.ts # ポストフロップ戦略
    │       ├── boardAnalysis.ts  # ボードテクスチャ分析
    │       ├── handStrength.ts   # ハンド強度評価
    │       ├── equityEstimator.ts # エクイティ推定
    │       ├── blockerAnalysis.ts # ブロッカー分析
    │       └── nutsAnalysis.ts   # ナッツ分析
    └── types/
        └── websocket.ts          # WebSocketイベント型定義（C2S/S2C）
```

### game/handlers.ts と TableInstance の責務分担

- **handlers.ts** — odId（ユーザー）起点。テーブルの外側の処理（DB問い合わせ、残高チェック、バイイン控除、テーブル選択・移動、エラーレスポンス）
- **TableInstance** — seatIndex（席番号）起点。テーブルの内側の処理（ハンド進行、アクション処理、状態ブロードキャスト、ショーダウン演出）
- 判断基準: DBやTableManagerを触るなら handlers、GameStateを触るなら TableInstance

### ゲームフロー（オンライン）

1. ロビーでブラインド選択 → `matchmaking:join` でFFキュー参加
2. `MatchmakingPool` がテーブル割り当て → `matchmaking:table_assigned`
3. `TableInstance.seatPlayer()` → Socket.ioルーム参加 → `game:state` 送信
4. `startNewHand()`: デッキシャッフル → 4枚配布 → `game:hole_cards`（個別送信）
5. ベッティング: `game:action_required` → プレイヤーアクション → `game:action_taken`
6. ストリート進行: preflop → flop → turn → river → showdown
7. ハンド完了: `game:hand_complete` → チップ更新 → 次ハンド自動開始

### Socket.ioイベント

**Client → Server:**
- `table:leave` - テーブル離脱
- `game:action`, `game:fast_fold` - ゲームアクション
- `matchmaking:join`, `matchmaking:leave` - マッチメイキング
- `debug:set_chips` - デバッグ用チップ設定（開発環境のみ）

**Server → Client:**
- `connection:established` - 接続確認（playerId通知）
- `game:state` - ゲーム状態更新（ルーム全体ブロードキャスト）
- `game:hole_cards` - ホールカード（各プレイヤー個別送信）
- `game:action_required`, `game:action_taken` - アクション
- `game:hand_complete`, `game:showdown` - ハンド結果
- `table:joined`, `table:left`, `table:error` - テーブル状態
- `table:change`, `table:busted` - FastFoldテーブル移動/バスト
- `maintenance:status` - メンテナンス通知

### ゲーム状態の変換フロー

```
サーバー内部: GameState（全カード情報あり）
    ↓ StateTransformer.toClientGameState()
クライアント送信: ClientGameState（カード情報なし）
    ↓ game:hole_cards で自分のカードのみ別送
クライアント内部: useOnlineGameState が GameState に再変換
    ↓ 自分のカードだけ holeCards にセット
レンダリング: PokerTable → Player（showCards=false → 裏面表示）
```

### UIレイアウト（9:16縦画面）

```
┌──────────────────┐
│ ヘッダー (4%)     │  ← PLO | ブラインド | 設定
├──────────────────┤
│                  │
│   PokerTable     │  ← 楕円テーブル、6人配置
│   (flex-1)       │     CommunityCards（中央）
│                  │     Player × 6（円周配置）
│                  │     Pot表示（中央下）
├──────────────────┤
│ MyCards (24cqw)  │  ← 自分の4枚
├──────────────────┤
│ ActionPanel      │  ← プリセット+スライダー+3ボタン
└──────────────────┘
```

### プレイヤー配置（PokerTable）

- `humanIndex`（自分の席番号）を基準に6人を回転配置
- `positionIndex=0` が画面下部（自分の位置）
- `positionIndex !== 0` のプレイヤーのみ Player にカード表示（自分は MyCards で表示）

### 認証フロー

1. Twitter OAuth 1.0a → サーバーがJWT発行 → httpOnly Cookie
2. WebSocket接続時に Cookie から token 取得 → `socket.handshake.auth.token`
3. 認証失敗/未認証 → ゲスト（`guest_${socket.id}`）として接続

### ハンド履歴

- **HandHistoryRecorder** (`server/src/modules/table/helpers/HandHistoryRecorder.ts`) - ハンド完了時にDB保存（fire-and-forget）
- **history/routes.ts** (`server/src/modules/history/routes.ts`) - `GET /api/history`（一覧）, `GET /api/history/:handId`（詳細）
- **HandHistory.tsx** (`src/pages/HandHistory.tsx`) - 履歴一覧・詳細閲覧UI（`/history`）
- 認証済みユーザーのみ保存対象（guest/botは除外）
- Prismaモデル: `HandHistory` + `HandHistoryPlayer`
- アクション履歴にはストリート情報（`street`）とディーラー位置（`dealerPosition`）を含む

### プレイヤースタッツ

- **computeStats.ts** (`server/src/modules/stats/computeStats.ts`) - ハンド履歴からスタッツを集計計算
- **stats/routes.ts** (`server/src/modules/stats/routes.ts`) - `GET /api/stats/:userId`（認証不要、60秒キャッシュ）
- **ProfilePopup.tsx** (`src/components/ProfilePopup.tsx`) - プレイヤークリック時にスタッツ表示
- 表示スタッツ: VPIP, PFR, 3Bet, AFq, CBet, Fold to CBet, Fold to 3Bet, WTSD, W$SD, 勝率, 損益
- 直近1000ハンドから計算、ストリート情報のない旧データはハンド数・勝率のみ

### プリフロップハンド評価

`packages/shared/src/preflopEquity.ts` で提供。フロントエンド（HandAnalysisOverlay）とサーバー（Bot AI）の両方が使用。

**スコア算出（2段階）:**

1. **エクイティルックアップ**: 事前計算済みモンテカルロシミュレーション結果（16,432通りの正規化ハンド × 10K反復）から6人テーブルでのオールインエクイティを引き、0-1に min-max 正規化
2. **プレイアビリティ補正**: エクイティ実現率を構造フラグで調整

| 補正項目 | 値 | 理由 |
|---------|------|------|
| ダブルスーテッド | +0.04 | フラッシュドロー2つでエクイティ実現◎ |
| シングルスーテッド | +0.02 | フラッシュドロー1つ |
| ランダウン（ダングラーなし） | +0.03 | ストレートドロー豊富 |
| ラップポテンシャル | +0.01 | ドロー力あり |
| Aスーテッド | +0.02 | ナッツフラッシュドロー保証 |
| ダングラー | -0.04 | 孤立カード、ポストフロップ不参加 |
| トリプルスーテッド | -0.03 | フラッシュアウツ減少 |
| レインボー | -0.02 | フラッシュドローなし |
| ペア+レインボー（ドローなし） | -0.03 | セット以外の発展性なし |

**インターフェース:**

```typescript
interface PreFlopEvaluation {
  score: number;           // 0-1（エクイティ+プレイアビリティ）
  hasPair: boolean;
  pairRank: string | null; // "AA", "KK" 等
  hasAceSuited: boolean;
  isDoubleSuited: boolean;
  isSingleSuited: boolean;
  isRundown: boolean;      // 連続4枚（5-6-7-8等）
  hasWrap: boolean;        // span≤4で3枚以上
  hasDangler: boolean;     // gap≥4の孤立カード
}
```

### Bot AI（プリフロップ戦略）

`server/src/shared/logic/ai/preflopStrategy.ts` でBotのプリフロップ判断を制御。

**判断フロー:**

```
effectiveStrength = score + positionBonus
         ↓
AAxx? → playPremium（常にレイズ）
         ↓
> 0.85 → playPremium（70-90%レイズ、残りトラップ）
         ↓
4bet直面? → 0.80+ かつ ペア/DS のみコール、他フォールド
         ↓
3bet直面? → facing3BetDecision（構造+パーソナリティ判定）
         ↓
> pfrThreshold → オープンレイズ or コール
         ↓
> vpipThreshold → チェック（BB）/ コール（ポットオッズ次第）/ 未レイズならフォールド
         ↓
弱い → チェック or フォールド（BTN/COからスチール可能性あり）
```

**閾値:**

| パラメータ | 計算式 | TAG(vpip=0.20) | LAG(vpip=0.38) |
|-----------|--------|---------------|---------------|
| vpipThreshold | max(0.55, 0.85 - vpip×0.65) | 0.72 | 0.60 |
| pfrThreshold | vpipThreshold + (vpip-pfr)×0.8 | 0.76 | 0.68 |
| 3bet防御最低 | 0.60 + (1-vpip)×0.15 | 0.72 | 0.69 |

**ポジションボーナス:** BTN +0.10, CO +0.08, HJ +0.05, UTG ±0, SB/BB -0.05

### 設計パターン

- **Immutable state**: GameStateは不変として扱い、新しい状態を返す
- **Pure functions**: ゲームロジックはUIから独立
- **Singleton WebSocket**: `wsService` でSocket.io接続を一元管理
- **Socket.io Room**: `table:${tableId}` で各テーブルのプレイヤーをグループ化
- **Fire-and-forget**: ハンド履歴保存は非同期（ゲーム進行をブロックしない）
- **切断猶予**: 30秒のgrace periodで再接続対応
- **アクションタイムアウト**: 10秒で自動フォールド
- **同一ユーザー単一接続**: 複数タブ/ブラウザからの重複接続を防止（後述）

### ポーカールームメタファー（サーバー内部構造）

サーバー内部のデータ構造とフローを、実際のポーカールームに例えた対応表。

```
┌─────────────────────────────────────────────────┐
│  ポーカールーム（setupGameSocket）                │
│                                                 │
│  受付名簿（activeConnections: Map<odId, socket>）│
│     「山田さん → 今店内にいる本人」              │
│                                                 │
│  フロアマネージャー（TableManager）              │
│     手帳（playerTables: Map<odId, tableId>）     │
│        「山田さん → 3番テーブル」                │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Table 1  │  │ Table 2  │  │ Table 3  │      │
│  │ 1/3 通常 │  │ 1/3 FF   │  │ 1/2 通常 │      │
│  │(Instance)│  │(Instance)│  │(Instance)│      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  キャッシャー（bankroll / cashOutPlayer）         │
└─────────────────────────────────────────────────┘
```

| コード | ポーカールーム | 補足 |
|--------|---------------|------|
| `socket` | お客さんとの**電話回線** | 切れたら新しい回線（socket.id）で繋がり直す |
| `odId` | **会員証** | 同一人物なら回線が変わっても同じ |
| `socket.id` | **回線番号** | Socket.ioが自動発行、接続ごとにユニーク |
| `activeConnections` | 入口の**受付名簿** | 会員証 → 今繋がっている回線 |
| `TableManager` | **フロアマネージャー** | テーブル管理・案内係 |
| `playerTables` | フロアの**手帳** | 誰がどのテーブルにいるか |
| `TableInstance` | 個別の**ポーカーテーブル** | ディーラー付き |
| `SeatInfo` | テーブルの**椅子** | 座っている人の回線（socket）への参照 |
| `BroadcastService` | ディーラーの**声** | テーブル全員に聞こえる |
| `emitToSocket` | ディーラーが**個人にこっそり囁く** | ホールカード配布等 |
| `Socket.io Room` | テーブルの**周囲** | そこにいる人だけ聞こえる範囲 |
| `cashOutPlayer` | **キャッシャー** | チップ→残高に換金 |
| `gracePeriodTimers` | フロアの**「席キープ」メモ** | 「この人30秒以内に戻るかも」 |
| `markPlayerDisconnected` | **「トイレ行きます」** | チップ置いたまま回線が切れる |
| `reconnectPlayer` | **「戻りました」** | 新しい回線で同じ席に繋がり直す |

**入店〜着席:**
1. 入口で会員証を見せる（authMiddleware）→ 入店許可
2. 受付名簿をチェック（activeConnections）→ 同一人物の旧回線があったら切断する（displaced）
3. フロアに「席ある？」（matchmaking:join）→ **席キープメモを確認、あれば同じ席に復帰**（reconnectPlayer）
4. 復帰でなければ → 手帳で既に座ってたら先に立たせる
5. フロアが空き席を探す（getOrCreateTable）→ 手帳に記録（setPlayerTable）
6. テーブルに座る（seatPlayer）→ 椅子に回線を紐づけ → テーブル周囲に入る（socket.join）

**切断〜復帰（grace period）:**
1. 回線途絶（disconnect）→ 椅子にチップを置いたまま回線だけ切れる（markPlayerDisconnected）
2. フロアが「席キープ」メモに30秒タイマーを記録（gracePeriodTimers）
3. 30秒以内に新しい回線で戻ってきた → 同じ椅子に繋ぎ直す（reconnectPlayer）→ ホールカード再配布
4. 30秒超えたら → フロアが「もう戻らないな」→ 椅子から立たせてチップ換金（unseatAndCashOut）

**退席〜退店（自発的離脱）:**
1. 椅子から立つ（unseatPlayer）→ テーブル周囲から離れる（socket.leave）
2. キャッシャーでチップを換金（cashOutPlayer）
3. フロアが手帳から消す（removePlayerFromTracking）
4. 受付名簿から消す（activeConnections.delete）

**FastFold = 高速テーブル移動:**
フォールドした瞬間にフロアが飛んできて「別テーブルへどうぞ！」（movePlayerToNewTable）。チップを持ったまま即座に別テーブルへ移動し、新しいハンドに参加。

**同一ユーザー単一接続（displaced）:**
同一人物が別のタブから新しい回線で接続すると、受付が名簿をチェックして旧回線に「別の回線を優先します」と通知（connection:displaced）し切断する。新しい回線がフロアに案内される際、旧回線が紐づいていた椅子は通常の入店フローで片付けられる。displacedの場合は席キープメモは作らない（意図的な接続切り替えのため）。

### 管理ダッシュボード

- `/admin/status` - HTMLダッシュボード（2秒自動更新）
- `/api/admin/stats` - JSON API
- テーブル一覧、プレイヤー状態、アクション待機、メッセージログ表示

## Deployment (Railway)

### 構成

1つのWebサービスとしてデプロイ。Fastifyサーバーがフロントエンドの静的ファイルも配信する。

```
Railway Project
├── Web Service (Fastify + 静的ファイル配信)
└── PostgreSQL (アドオン)
```

### ビルド・起動

```bash
npm run build:all   # フロントビルド + サーバーのprisma generate
npm run start       # 本番サーバー起動 (cd server && node --import tsx src/index.ts)
```

`railway.toml` でビルド・起動コマンドを設定済み。

### Railway セットアップ手順

1. Railway でプロジェクト作成、GitHubリポジトリを接続
2. PostgreSQL アドオン追加 → `DATABASE_URL` が自動設定される
3. 環境変数を設定:

| 変数名 | 値 | 備考 |
|--------|-----|------|
| `NODE_ENV` | `production` | 必須 |
| `JWT_SECRET` | ランダム文字列 | 32文字以上、必須 |
| `CLIENT_URL` | `https://<app>.up.railway.app` | デプロイ先URL |
| `TWITTER_CLIENT_ID` | Twitter Developer Portalから | OAuth用 |
| `TWITTER_CLIENT_SECRET` | Twitter Developer Portalから | OAuth用 |
| `DATABASE_URL` | (自動) | PostgreSQLアドオンから |
| `PORT` | (自動) | Railwayが`$PORT`で提供 |

5. デプロイ実行（`main` ブランチへのpushで自動デプロイ。`develop` ブランチはデプロイされない）
6. `https://<app>.up.railway.app/health` でヘルスチェック確認

### 環境変数の仕組み

- フロントエンド: `VITE_SERVER_URL` で接続先を制御。本番では未設定（空文字 = 同一オリジン）
- 開発時: `.env.development` で `VITE_SERVER_URL=http://localhost:3001` を設定
- サーバー: `server/.env` または Railway の環境変数で設定
- 本番SPA: `setNotFoundHandler` で API/admin/health 以外を `index.html` にフォールバック
