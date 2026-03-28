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
- Railway (本番デプロイ) — 手順は [docs/deployment-railway.md](docs/deployment-railway.md)

## Architecture

### コードの置き場（地図）

詳細なファイルツリーはリポジトリを参照。主要な境界だけ押さえる。

- **`packages/shared/`** — フロントとサーバー共通（型、デッキ、PLO 評価、プリフロップエクイティ、WebSocket の protocol 等）。**重複ロジックはここへ寄せる**。
- **`src/`** — クライアント。`main.tsx`（ルーティング）、`pages/`、`components/`、`hooks/`（例: `useOnlineGameState.ts`）、`services/websocket.ts`（`wsService`）、`logic/`。
- **`server/src/index.ts`** — Fastify + Socket.io + 本番静的配信のエントリ。
- **`server/src/modules/`** — 機能別モジュール（例: `game/` の socket・handlers、`table/` の `TableManager`・`TableInstance` と helpers、`fastfold/`、`auth/`、`history/`、`stats/`、`tournament/`、`admin/` 等）。**新規機能は既存モジュールに収まるか検討してから追加**。
- **`server/src/shared/logic/`** — サーバー側ゲームエンジン・Bot AI（`ai/` 以下）。ゲーム進行の正は `gameEngine` とテーブル層。

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

### 認証フロー

1. Twitter OAuth 1.0a → サーバーがJWT発行 → httpOnly Cookie
2. WebSocket接続時に Cookie から token 取得 → `socket.handshake.auth.token`
3. 認証失敗/未認証 → ゲスト（`guest_${socket.id}`）として接続

### UI レイアウト・席の見え方

9:16 縦画面のブロック構成と `PokerTable` の回転配置は [docs/ui-mobile-layout.md](docs/ui-mobile-layout.md)。

### ハンド履歴

- 保存: `server/src/modules/table/helpers/HandHistoryRecorder.ts`（ハンド完了時、fire-and-forget）
- API: `server/src/modules/history/routes.ts` — `GET /api/history`, `GET /api/history/:handId`
- UI: `src/pages/HandHistory.tsx`（`/history`）
- 認証済みユーザーのみ保存（guest/bot は除外）。Prisma: `HandHistory`, `HandHistoryPlayer`

### プレイヤースタッツ

- 集計: `server/src/modules/stats/computeStats.ts`
- API: `server/src/modules/stats/routes.ts` — `GET /api/stats/:userId`（60秒キャッシュ）
- UI例: `src/components/ProfilePopup.tsx`

### プリフロップハンド評価（スコア・補正の説明）

実装の正: `packages/shared/src/preflopEquity.ts`。人向けの概要は [docs/preflop-hand-evaluation.md](docs/preflop-hand-evaluation.md)。

### Bot AI

全体像とモジュール一覧: [docs/bot-strategy.md](docs/bot-strategy.md)。実装: `server/src/shared/logic/ai/`。

### SOLID & DRY（必須の設計姿勢）

コード変更・リファクタ・新規ファイルでは **SOLID 原則** と **DRY 原則** を常に意識する。抽象論で終わらせず、具体的な判断（責務の分割・共通化の場所・依存の向き）に落とし込む。

**SOLID**

- **S — 単一責任**: モジュール・クラス・関数は「変わる理由」が一つになるよう保つ。UI・DB・ドメイン・配信を同一ファイルに詰め込まない。既存の `handlers.ts` / `TableInstance` の分担のように、責務境界を明確にする。
- **O — 開放閉鎖**: 挙動の追加は既存コードの**拡張**（新しい分岐モジュール・ストラテジ・設定）で行い、安定した核を毎回書き換えない。やむを得ない変更は影響範囲を最小化する。
- **L — リスコフの置換**: サブタイプや実装の差し替えは、呼び出し側が期待する契約（型・不変条件・副作用）を壊さない。
- **I — インターフェース分離**: 巨大な型や「なんでもオプション」APIを増やさない。クライアントが使わないメソッドに依存させない。必要なら小さな型・関数群に分割する。
- **D — 依存性逆転**: 具象（DB・Socket・フレームワーク）にドメインが直接依存しないよう、テストや差し替えしやすい抽象（純粋関数・小さなポート）を挟む。既存の共有ロジック（`@plo/shared`・`gameEngine`）を優先して再利用する。

**DRY**

- **単一の真実の源泉**: 同じルール・定数・変換・型は一箇所に集約する。フロントとサーバーで重複するなら `packages/shared` や既存の共有モジュールへ寄せる。
- **コピペの禁止に近い意識**: 2回目で「共通化の候補」、3回目で**必ず**抽出を検討する。微妙に違う場合はパラメータ化・小関数への分割で一つにまとめる。
- **DRY の誤用を避ける**: 文脈が違うロジックを無理に一つに束ねて複雑化しない。重複の削除と責務の明確化はセットで考える。

レビュー観点: 新規コードが SOLID/DRY に反していないか、変更が既存の責務境界を侵食していないかを自分で一度確認してから完了とする。

### 設計パターン

- **Immutable state**: GameStateは不変として扱い、新しい状態を返す
- **Pure functions**: ゲームロジックはUIから独立
- **Singleton WebSocket**: `wsService` でSocket.io接続を一元管理
- **Socket.io Room**: `table:${tableId}` で各テーブルのプレイヤーをグループ化
- **Fire-and-forget**: ハンド履歴保存は非同期（ゲーム進行をブロックしない）
- **切断猶予**: 30秒のgrace periodで再接続対応
- **アクションタイムアウト**: 10秒で自動フォールド
- **同一ユーザー単一接続**: 複数タブからの接続は `connection:displaced` で片方を退避。流れの比喩は [docs/poker-room-metaphor.md](docs/poker-room-metaphor.md)

### サーバー内部の比喩（オンボーディング用）

`activeConnections` / `TableManager` / 着席・退店・FastFold などの対応表とストーリーは [docs/poker-room-metaphor.md](docs/poker-room-metaphor.md)（本ファイルでは重複しない）。

### 管理ダッシュボード

- `/admin/status` — HTML（自動更新）
- `/api/admin/stats` — JSON

## その他のドキュメント

設計案・個別機能のメモは `docs/` 配下（例: `architecture-redesign.md`, `mtt-design.md`）。デプロイ詳細は [docs/deployment-railway.md](docs/deployment-railway.md)。
