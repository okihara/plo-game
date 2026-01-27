# PLO Game Server

オンラインPLOポーカーゲームのバックエンドサーバー

## 技術スタック

- **Fastify** - 高速HTTPサーバー
- **Socket.io** - リアルタイム通信
- **PostgreSQL** - データベース
- **Prisma** - ORM
- **Redis** - セッション、ファストフォールドキュー

## セットアップ

### 1. 依存関係のインストール

```bash
cd server
npm install
```

### 2. 環境変数の設定

```bash
cp .env.example .env
```

`.env` ファイルを編集:

```env
# Database (PostgreSQLの接続URL)
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/plo_game?schema=public"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT (32文字以上の秘密鍵)
JWT_SECRET="your-secret-key-at-least-32-characters-long"

# Server
PORT=3001
NODE_ENV=development
CLIENT_URL="http://localhost:5173"
```

### 3. Docker でデータベース起動

プロジェクトルートで実行:

```bash
docker-compose up -d
```

これにより以下が起動:
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6379`

### 4. データベースのセットアップ

```bash
npm run db:push    # スキーマをDBに反映
npm run db:studio  # Prisma Studio (GUI) を起動
```

### 5. サーバー起動

```bash
npm run dev   # 開発モード (ホットリロード)
npm run build # 本番ビルド
npm start     # 本番起動
```

## NPM スクリプト

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動 (tsx watch) |
| `npm run build` | TypeScriptビルド |
| `npm start` | 本番サーバー起動 |
| `npm run db:push` | Prismaスキーマをデータベースに反映 |
| `npm run db:generate` | Prismaクライアント生成 |
| `npm run db:studio` | Prisma Studio起動 |

## ディレクトリ構成

```
server/
├── prisma/
│   └── schema.prisma    # データベーススキーマ
├── src/
│   ├── config/
│   │   ├── env.ts       # 環境変数バリデーション
│   │   ├── database.ts  # Prismaクライアント
│   │   └── redis.ts     # Redis接続
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── routes.ts    # OAuth2認証ルート
│   │   │   └── bankroll.ts  # バンクロールAPI
│   │   ├── game/
│   │   │   └── socket.ts    # WebSocketイベントハンドラ
│   │   ├── table/
│   │   │   ├── TableInstance.ts  # ゲームテーブル
│   │   │   └── TableManager.ts   # テーブル管理
│   │   └── fastfold/
│   │       └── FastFoldPool.ts   # ファストフォールドキュー
│   ├── shared/
│   │   └── logic/           # ゲームロジック (クライアントと共通)
│   └── index.ts             # エントリーポイント
└── package.json
```

## API エンドポイント

### REST API

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/health` | ヘルスチェック |
| GET | `/auth/google` | Google OAuth開始 |
| GET | `/auth/discord` | Discord OAuth開始 |
| POST | `/auth/dev-login` | 開発用ログイン |
| GET | `/api/bankroll` | 残高取得 |
| POST | `/api/bankroll/daily-bonus` | デイリーボーナス取得 |
| POST | `/api/bankroll/refill` | チップ補充 |

### WebSocket イベント

#### クライアント → サーバー

| イベント | データ | 説明 |
|---------|--------|------|
| `table:join` | `{ tableId, buyIn }` | テーブル参加 |
| `table:leave` | - | テーブル離脱 |
| `game:action` | `{ action, amount? }` | アクション送信 |
| `game:fast_fold` | - | ファストフォールド |
| `fastfold:join` | `{ blinds }` | ファストフォールドプール参加 |
| `fastfold:leave` | - | プール離脱 |

#### サーバー → クライアント

| イベント | データ | 説明 |
|---------|--------|------|
| `connection:established` | `{ playerId }` | 接続確立 |
| `table:joined` | `{ tableId, seat }` | テーブル着席完了 |
| `game:state` | `{ state }` | ゲーム状態更新 |
| `game:hole_cards` | `{ cards }` | ホールカード配布 |
| `game:action_required` | `{ playerId, validActions, timeoutMs }` | アクション要求 |
| `fastfold:queued` | `{ position }` | キュー待機中 |
| `fastfold:table_assigned` | `{ tableId }` | 新テーブル割当 |

## ゲストモード

認証なしでもゲストとして接続可能:

- ゲストID: `guest_<socket.id>`
- ゲスト名: `Guest<ランダム番号>`
- デフォルトチップ: $300 (BB x 100)

## 開発時のヒント

### ログ確認

サーバーログにプレイヤー接続/切断が表示されます:

```
Player connected: guest_xxx (Guest1234)
Player disconnected: guest_xxx (Guest1234)
```

### データベース確認

```bash
npm run db:studio
```

ブラウザで `http://localhost:5555` が開き、データを確認できます。

### Redis確認

```bash
docker exec -it plo-redis redis-cli
> KEYS *
> GET session:xxx
```
