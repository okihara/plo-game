# PLOポーカーゲーム オンライン化 + ファストフォールド実装計画

## 概要

現在のシングルプレイヤーPLOポーカーゲームを完全オンライン化し、PokerStars Zoomスタイルのファストフォールド機能を実装する。

## 決定事項

| 項目 | 選択 |
|------|------|
| CPU補充 | ✅ プレイヤー不足時はCPUで補充 |
| 認証方式 | ✅ ソーシャルログイン（Google/Apple/Discord） |
| チップ | ✅ プレイマネー（毎日補充、ログインボーナス） |
| MVP範囲 | ✅ ファストフォールドのみ（1ステークス）|

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (React + Vite)                     │
│  WebSocket接続 → useOnlineGameState フック                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ Socket.io
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Game Server (Node.js + Fastify)              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │TableManager │  │MatchmakingPool│  │ GameEngine  │         │
│  │ (テーブル管理)│  │(キュー管理) │  │ (既存ロジック)│         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────┬───────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│    Redis    │      │  PostgreSQL │      │  既存ロジック │
│ - Session   │      │ - Users     │      │ - gameEngine│
│ - Pub/Sub   │      │ - Bankroll  │      │ - handEval  │
│ - Queue     │      │ - History   │      │ - types     │
└─────────────┘      └─────────────┘      └─────────────┘
```

## 技術スタック

| レイヤー | 技術 | 理由 |
|---------|------|------|
| バックエンド | Fastify + Socket.io | 高速、TypeScript対応 |
| リアルタイム | Socket.io | 自動再接続、Room機能 |
| キャッシュ/キュー | Redis | セッション、Pub/Sub、ファストフォールドキュー |
| データベース | PostgreSQL + Prisma | ACID準拠、型安全ORM |
| 認証 | OAuth2 (Google/Apple/Discord) + JWT | ソーシャルログイン |

## ディレクトリ構成

```
plo-game/
├── client/                      # 既存フロントエンド（移動）
│   └── src/
│       ├── hooks/
│       │   └── useOnlineGameState.ts  # 新規：WebSocket版
│       ├── services/
│       │   ├── api.ts                 # 新規：REST API
│       │   └── websocket.ts           # 新規：WebSocket
│       ├── pages/
│       │   ├── Login.tsx              # 新規
│       │   ├── Lobby.tsx              # 新規
│       │   └── Game.tsx               # 既存App.tsxから
│       └── context/
│           └── AuthContext.tsx        # 新規
│
├── server/                      # 新規バックエンド
│   └── src/
│       ├── modules/
│       │   ├── auth/            # 認証
│       │   ├── game/            # WebSocketゲートウェイ
│       │   ├── table/           # テーブル管理
│       │   └── fastfold/        # ファストフォールド
│       └── shared/
│           └── logic/           # 既存ロジック移植
│               ├── types.ts
│               ├── gameEngine.ts
│               └── handEvaluator.ts
│
└── shared/                      # クライアント/サーバー共通型
    └── types/
        └── websocket.ts
```

## ファストフォールド フロー

```
プレイヤーがフォールド
      │
      ▼
┌─────────────────┐
│ ファストフォールド │
│ フラグON         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Redisキューに   │────▶│ 空席テーブル検索 │
│ 追加            │     └────────┬────────┘
└─────────────────┘              │
                      ┌──────────┴──────────┐
                      ▼                     ▼
              ┌─────────────┐       ┌─────────────┐
              │ 即座に着席   │       │ キュー待機   │
              │ (空席あり)   │       │ (数百ms)    │
              └─────────────┘       └─────────────┘
                      │                     │
                      └──────────┬──────────┘
                                 ▼
                    ┌─────────────────────┐
                    │ 新テーブルでハンド開始│
                    └─────────────────────┘
```

## Redis活用

```typescript
// キー設計
session:{sessionId}           // セッションデータ
table:state:{tableId}         // ゲーム状態
matchmaking:queue:{blinds}    // マッチメイキングキュー（Sorted Set）
player:table:{odId}          // プレイヤーの現在テーブル
channel:table:{tableId}       // Pub/Subチャンネル
```

## WebSocketイベント

```typescript
// クライアント → サーバー
'game:action'     // アクション送信
'game:fold'  // ファストフォールド
'table:join'      // テーブル参加
'table:leave'     // テーブル離脱

// サーバー → クライアント
'table:state'         // ゲーム状態更新
'game:hole_cards'     // ホールカード配布
'game:action_required'// アクション要求（タイマー付き）
'matchmaking:queued'     // キュー位置通知
'matchmaking:table_assigned' // 新テーブル割当
```

## データベース（主要テーブル）

```sql
-- ユーザー
users (id, email, username, password_hash, avatar_url)

-- バンクロール
bankrolls (user_id, balance)

-- トランザクション
transactions (id, user_id, type, amount, table_id, hand_id)

-- ハンド履歴
hand_histories (id, table_id, hand_number, community_cards,
                pot_size, winners, actions, created_at)
```

## 実装フェーズ（MVP: ファストフォールドのみ）

### Phase 1: バックエンド基盤 ✅
- [x] Fastify + TypeScript プロジェクトセットアップ
- [x] PostgreSQL + Prisma セットアップ
- [x] Redis 接続設定
- [x] dotenv 環境変数読み込み
- [ ] OAuth2 認証 (Google/Discord) - 保留
- [x] プレイマネー管理 API

### Phase 2: ゲームサーバー ✅
- [x] Socket.io 統合
- [x] 既存 gameEngine.ts / cpuAI.ts 移植
- [x] TableInstance 実装（CPU補充対応）
- [x] アクションタイマー実装

### Phase 3: ファストフォールドプール ✅
- [x] MatchmakingPool 実装
- [x] Redis キュー管理（Sorted Set）
- [x] テーブル間移動ロジック
- [x] CPU補充ロジック（プレイヤー不足時）

### Phase 4: フロントエンド統合 ✅
- [x] シンプルロビー UI
- [x] WebSocket クライアント (socket.io-client)
- [x] useOnlineGameState フック作成
- [x] OnlineGame ページ作成
- [x] 既存コンポーネント再利用

### Phase 5: デプロイ・テスト ⏳
- [x] Docker Compose 設定
- [x] ローカル環境動作確認 (サーバー + Redis + PostgreSQL)
- [ ] マルチプレイヤーテスト
- [ ] 本番デプロイ（Railway / Fly.io）

## 重要ファイル（既存コード再利用）

- `src/logic/gameEngine.ts` - サーバーに移植（変更なし）
- `src/logic/types.ts` - 共通型として使用
- `src/logic/handEvaluator.ts` - サーバーに移植
- `src/logic/cpuAI.ts` - サーバーに移植（CPU補充用）
- `src/hooks/useGameState.ts` - 参照（WebSocket版に書き換え）

## 検証方法

1. **ローカル動作確認**
   - `docker-compose up` で Redis + PostgreSQL 起動
   - `npm run dev:server` でバックエンド起動
   - `npm run dev:client` でフロントエンド起動

2. **マルチプレイヤーテスト**
   - 複数ブラウザタブで同時接続
   - アクションの同期確認

3. **ファストフォールドテスト**
   - フォールド後の即座のテーブル移動
   - キュー待機時の UI 確認
