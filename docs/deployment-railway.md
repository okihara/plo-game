# Railway デプロイ

本番は 1 つの Web サービスとしてデプロイする。Fastify が API とフロントの静的ファイルの両方を配信する。

## 構成

```
Railway Project
├── Web Service (Fastify + 静的ファイル配信)
└── PostgreSQL (アドオン)
```

## ビルド・起動

```bash
npm run build:all   # フロントビルド + サーバーの prisma generate
npm run start       # 本番サーバー起動 (cd server && node --import tsx src/index.ts)
```

`railway.toml` でビルド・起動コマンドを設定済み。

## Railway セットアップ手順

1. Railway でプロジェクト作成、GitHub リポジトリを接続する。
2. PostgreSQL アドオンを追加する → `DATABASE_URL` が自動設定される。
3. 環境変数を設定する:

| 変数名 | 値 | 備考 |
|--------|-----|------|
| `NODE_ENV` | `production` | 必須 |
| `JWT_SECRET` | ランダム文字列 | 32 文字以上、必須 |
| `CLIENT_URL` | `https://<app>.up.railway.app` | デプロイ先 URL |
| `TWITTER_CLIENT_ID` | Twitter Developer Portal から | OAuth 用 |
| `TWITTER_CLIENT_SECRET` | Twitter Developer Portal から | OAuth 用 |
| `DATABASE_URL` | (自動) | PostgreSQL アドオンから |
| `PORT` | (自動) | Railway が `$PORT` で提供 |

4. デプロイ実行（`main` ブランチへの push で自動デプロイ。`develop` ブランチはデプロイされない）。
5. `https://<app>.up.railway.app/health` でヘルスチェックを確認する。

## 環境変数の仕組み（開発と本番）

- **フロントエンド**: `VITE_SERVER_URL` で接続先を制御。本番では未設定（空文字 = 同一オリジン）。
- **開発時**: `.env.development` で `VITE_SERVER_URL=http://localhost:3001` を設定する。
- **サーバー**: `server/.env` または Railway の環境変数で設定する。
- **本番 SPA**: `setNotFoundHandler` で API / admin / health 以外を `index.html` にフォールバックする。
