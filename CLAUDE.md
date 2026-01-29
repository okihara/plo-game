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
