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
| `CLIENT_URL` | `https://babyplo.app` | デプロイ先の正規 URL（OGP / 既定リダイレクト先） |
| `CLIENT_URL_ALIASES` | `https://baby-plo.up.railway.app` | 移行期に追加で許可するオリジン。カンマ区切り。CORS / Socket.io / OAuth コールバックの許可ホストに加わる。完全に切り替えたら未設定に戻す |
| `TWITTER_CLIENT_ID` | Twitter Developer Portal から | OAuth 用 |
| `TWITTER_CLIENT_SECRET` | Twitter Developer Portal から | OAuth 用 |
| `DATABASE_URL` | (自動) | PostgreSQL アドオンから |
| `PORT` | (自動) | Railway が `$PORT` で提供 |

4. デプロイ実行（`main` ブランチへの push で自動デプロイ。`develop` ブランチはデプロイされない）。
5. `https://babyplo.app/health`（カスタムドメイン未設定なら `https://<app>.up.railway.app/health`）でヘルスチェックを確認する。

## カスタムドメイン (`babyplo.app`)

本番では `babyplo.app` をカスタムドメインとして接続している。新規環境で再現する場合の手順:

1. **Railway 側でドメインを追加**
   - Web サービスの **Settings → Networking → Custom Domains** で `babyplo.app` を追加する。
   - Railway が表示する **CNAME ターゲット**（例: `xxxx.up.railway.app`）を控える。
   - apex（裸ドメイン）に CNAME を貼れない DNS を使う場合は ALIAS / ANAME / CNAME flattening が使えるか確認する。
2. **DNS レコードを設定**
   - レジストラ（または DNS プロバイダ）の管理画面で以下を登録する:
     - `babyplo.app` → CNAME / ALIAS / ANAME で Railway のターゲットへ
     - `www.babyplo.app` を使う場合は同じターゲットへ CNAME
   - 反映には数分〜数時間かかる。Railway 側のドメイン状態が **Active** になるまで待つ。
3. **TLS 証明書**
   - Railway が Let's Encrypt で自動発行する。発行完了まで数分待つ。
4. **環境変数を更新**
   - `CLIENT_URL` を `https://babyplo.app` に設定し直してサービスを再デプロイする（CORS / Cookie / OAuth コールバック生成の正規 URL）。
   - 移行期は **`CLIENT_URL_ALIASES=https://baby-plo.up.railway.app`** も併設する。サーバーは許可リストに含まれるホスト宛のアクセスについて CORS / Socket.io / OAuth コールバックを動的に許可するため、ユーザーは新旧どちらの URL からでもログインしてプレイできる。新ドメインへ完全移行したら `CLIENT_URL_ALIASES` を削除する。
5. **Twitter Developer Portal を更新**
   - OAuth アプリの **Callback URL** に `https://babyplo.app/api/auth/twitter/callback` を追加する。移行期は旧 `https://baby-plo.up.railway.app/api/auth/twitter/callback` も登録したままにする（旧 URL からの OAuth フローを成立させるため）。
   - **Website URL** も `https://babyplo.app` に更新する。
6. **動作確認**
   - `https://babyplo.app/health` が 200 を返す。
   - Twitter ログイン → コールバックが新ドメインで完了する。
   - WebSocket（ロビー入室・対戦）が同一オリジンで接続される。
   - OGP プレビュー（X / Discord 等）が新 URL の画像を引く。

## 環境変数の仕組み（開発と本番）

- **フロントエンド**: `VITE_SERVER_URL` で接続先を制御。本番では未設定（空文字 = 同一オリジン）。
- **開発時**: `.env.development` で `VITE_SERVER_URL=http://localhost:3001` を設定する。
- **サーバー**: `server/.env` または Railway の環境変数で設定する。
- **本番 SPA**: `setNotFoundHandler` で API / admin / health 以外を `index.html` にフォールバックする。
