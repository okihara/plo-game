# PLO Poker Game

スマートフォン向けのPot Limit Omaha (PLO) ポーカーゲーム。

## 特徴

- 6-MAX テーブル
- CPU対戦（5人のAIプレイヤー）
- モバイルファーストのUI（GG Poker風デザイン）
- Pot Limit Omaha ルール（4枚のホールカード、2枚+3枚でハンドを作る）

## 開発

### オフラインモード（CPU対戦）

```bash
# 依存関係のインストール
npm install

# 開発サーバーの起動
npm run dev

# ビルド
npm run build
```

### オンラインモード（マルチプレイヤー）

オンラインモードには、バックエンドサーバーとボットの起動が必要です。

#### 1. インフラ起動（PostgreSQL + Redis）

```bash
docker-compose up -d
```

#### 2. サーバーセットアップ

```bash
cd server
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集してJWT_SECRETなどを設定

# データベースのセットアップ
npm run db:push
```

#### 3. サーバー起動

```bash
cd server
npm run dev          # 開発モード（ホットリロード）
# または
npm run start        # 本番モード（要事前ビルド: npm run build）
```

サーバーは `http://localhost:3001` で起動します。

#### 4. ボット起動（オプション）

プレイヤーが少ない場合にテーブルを埋めるCPUボットを起動できます。

```bash
cd server
npm run bot          # ボット起動
# または
npm run bot:dev      # 開発モード（ホットリロード）
```

環境変数でボットの動作をカスタマイズできます:

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `SERVER_URL` | `http://localhost:3001` | 接続先サーバー |
| `BOT_COUNT` | `10` | 起動するボット数 |
| `BLINDS` | `1/3` | 参加するブラインドレベル |

例:
```bash
BOT_COUNT=5 BLINDS=1/3 npm run bot
```

#### 全体起動（3ターミナル）

```bash
# ターミナル1: フロントエンド
npm run dev

# ターミナル2: バックエンドサーバー
cd server && npm run dev

# ターミナル3: ボット（オプション）
cd server && npm run bot
```

## 技術スタック

- TypeScript
- Vite
- Vanilla JS (フレームワークなし)

## ゲームルール

PLO (Pot Limit Omaha) は、テキサスホールデムの派生ゲームです。

- 各プレイヤーに4枚のホールカードが配られる
- 5枚のコミュニティカードが場に出る
- **必ず**ホールカードから2枚、コミュニティカードから3枚を使って5枚のハンドを作る
- ベットはポットリミット（最大ベット額はポットサイズまで）
