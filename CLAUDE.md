# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PLOポーカーゲーム - スマートフォン向けPot Limit Omaha実装。

- **オフラインモード**: プレイヤー1人 vs CPU 5人の6-MAXテーブル
- **オンラインモード**: リアルタイムマルチプレイヤー、ファストフォールド対応

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
docker-compose up -d              # PostgreSQL + Redis起動
cd server && npm install          # 依存関係インストール
npm run db:push                   # データベーススキーマ反映

# 開発
cd server && npm run dev          # サーバー起動 (localhost:3001)
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
- Tailwind CSS
- Socket.io-client (WebSocket)

### バックエンド
- Fastify + TypeScript
- Socket.io (リアルタイム通信)
- PostgreSQL + Prisma (データベース)
- Redis (セッション、キュー)

### インフラ
- Docker Compose (PostgreSQL, Redis)
- Railway (本番デプロイ)

## Architecture

### コアモジュール

- **main.ts** - エントリーポイント。ゲームループ、イベントハンドリング、レンダリング統合
- **gameEngine.ts** - ポーカーロジック。状態管理、アクション処理、ハンド進行
- **cpuAI.ts** - CPU対戦AI。ハンド強度評価、ポジションボーナス、ポットオッズ計算
- **handEvaluator.ts** - PLOハンド評価。必須ルール: ホール2枚 + コミュニティ3枚
- **deck.ts** - カード操作。デッキ作成、シャッフル、配布
- **ui.ts** - UI描画。カード、プレイヤー、アクションパネル
- **styles.ts** - CSSスタイル全体
- **types.ts** - TypeScript型定義

### ゲームフロー

1. 6人プレイヤー初期化（人間1、AI 5）
2. ハンド開始: シャッフル、4枚ずつ配布
3. ベッティングラウンド: preflop → flop → turn → river
4. ショーダウン: PLOハンド評価
5. 勝者決定・ポット分配
6. ディーラーボタン回転して次のハンド

### 設計パターン

- **Immutable state**: GameStateは不変として扱い、新しい状態を返す
- **Pure functions**: ゲームロジックはUIから独立
- **Async CPU**: `scheduleNextCPUAction()`で思考時間をシミュレート（800-2000ms）

## Deployment (Railway)

### 構成

1つのWebサービスとしてデプロイ。Fastifyサーバーがフロントエンドの静的ファイルも配信する。

```
Railway Project
├── Web Service (Fastify + 静的ファイル配信)
├── PostgreSQL (アドオン)
└── Redis (アドオン)
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
3. Redis アドオン追加 → `REDIS_URL` が自動設定される
4. 環境変数を設定:

| 変数名 | 値 | 備考 |
|--------|-----|------|
| `NODE_ENV` | `production` | 必須 |
| `JWT_SECRET` | ランダム文字列 | 32文字以上、必須 |
| `CLIENT_URL` | `https://<app>.up.railway.app` | デプロイ先URL |
| `TWITTER_CLIENT_ID` | Twitter Developer Portalから | OAuth用 |
| `TWITTER_CLIENT_SECRET` | Twitter Developer Portalから | OAuth用 |
| `DATABASE_URL` | (自動) | PostgreSQLアドオンから |
| `REDIS_URL` | (自動) | Redisアドオンから |
| `PORT` | (自動) | Railwayが`$PORT`で提供 |

5. デプロイ実行（GitHub pushで自動デプロイ）
6. `https://<app>.up.railway.app/health` でヘルスチェック確認

### 環境変数の仕組み

- フロントエンド: `VITE_SERVER_URL` で接続先を制御。本番では未設定（空文字 = 同一オリジン）
- 開発時: `.env.development` で `VITE_SERVER_URL=http://localhost:3001` を設定
- サーバー: `server/.env` または Railway の環境変数で設定
