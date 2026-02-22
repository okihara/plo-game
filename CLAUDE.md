# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PLOポーカーゲーム - スマートフォン向けPot Limit Omaha実装。

- **オンラインモード**: リアルタイムマルチプレイヤー
- **観戦モード**: `/spectate/:tableId` で全プレイヤーのカードを見ながらデバッグ観戦

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

### フロントエンド構成

```
src/
├── main.tsx                      # ルーティング（パスベース、React Router不使用）
├── pages/
│   ├── SimpleLobby.tsx           # ロビー（ブラインド選択・ログイン）
│   ├── OnlineGame.tsx            # メインゲーム画面
│   ├── SpectatorView.tsx         # デバッグ観戦画面
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
│   ├── useOnlineGameState.ts     # WebSocket + ゲーム状態管理（プレイヤー用）
│   └── useSpectatorState.ts      # WebSocket + ゲーム状態管理（観戦用）
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
│   │   └── socket.ts             # Socket.ioイベントハンドラ（認証MW、全イベント定義）
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
│   │       └── HandHistoryRecorder.ts # ハンド履歴DB保存（fire-and-forget）
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
    │   └── gameEngine.ts         # 共有ゲームロジック
    └── types/
        └── websocket.ts          # WebSocketイベント型定義（C2S/S2C）
```

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
- `table:join`, `table:leave`, `table:spectate` - テーブル参加/離脱/観戦
- `game:action`, `game:fold` - ゲームアクション
- `matchmaking:join`, `matchmaking:leave` - FFキュー

**Server → Client:**
- `game:state` - ゲーム状態更新（ルーム全体ブロードキャスト）
- `game:hole_cards` - ホールカード（各プレイヤー個別送信）
- `game:all_hole_cards` - 全員のカード（スペクテーター専用）
- `game:action_required`, `game:action_taken` - アクション
- `game:hand_complete`, `game:showdown` - ハンド結果
- `table:spectating` - 観戦開始確認

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

**スペクテーター:**
```
サーバー: game:all_hole_cards で全員のカードを送信
クライアント: useSpectatorState が全員の holeCards をセット
レンダリング: PokerTable(isSpectator) → Player(showCards=true) → 常時表面表示
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
│ MyCards (24cqw)  │  ← 自分の4枚（観戦モードはスペーサー）
├──────────────────┤
│ ActionPanel      │  ← プリセット+スライダー+3ボタン
└──────────────────┘
```

### プレイヤー配置（PokerTable）

- `humanIndex`（自分の席番号）を基準に6人を回転配置
- `positionIndex=0` が画面下部（自分の位置）
- `positionIndex !== 0` のプレイヤーのみ Player にカード表示（自分は MyCards で表示）
- `isSpectator=true` の場合は全positionでカード表示

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

### 設計パターン

- **Immutable state**: GameStateは不変として扱い、新しい状態を返す
- **Pure functions**: ゲームロジックはUIから独立
- **Singleton WebSocket**: `wsService` でSocket.io接続を一元管理
- **Socket.io Room**: `table:${tableId}` で各テーブルのプレイヤーをグループ化
- **Fire-and-forget**: ハンド履歴保存は非同期（ゲーム進行をブロックしない）
- **切断猶予**: 30秒のgrace periodで再接続対応
- **アクションタイムアウト**: 10秒で自動フォールド

### 管理ダッシュボード

- `/admin/status` - HTMLダッシュボード（2秒自動更新）
- `/api/admin/stats` - JSON API
- テーブル一覧、プレイヤー状態、アクション待機、メッセージログ、観戦リンク表示

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

5. デプロイ実行（GitHub pushで自動デプロイ）
6. `https://<app>.up.railway.app/health` でヘルスチェック確認

### 環境変数の仕組み

- フロントエンド: `VITE_SERVER_URL` で接続先を制御。本番では未設定（空文字 = 同一オリジン）
- 開発時: `.env.development` で `VITE_SERVER_URL=http://localhost:3001` を設定
- サーバー: `server/.env` または Railway の環境変数で設定
- 本番SPA: `setNotFoundHandler` で API/admin/health 以外を `index.html` にフォールバック
