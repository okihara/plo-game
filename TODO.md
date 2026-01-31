# PLOポーカーゲーム - 残作業リスト

## 現在のブランチ: `feature/online-multiplayer`

オンラインマルチプレイヤー機能の実装状況: **約90%完了**

---

## 優先度: 高（ローカル動作に必須）

### 1. チップのキャッシュアウト処理
- **ファイル**: [socket.ts:167](server/src/modules/game/socket.ts#L167)
- **内容**: `table:leave` イベントでプレイヤーの最終チップをBankrollに戻す処理が未実装
- **影響**: プレイヤーがテーブルを離脱する際、勝利したチップがDBに反映されない
- **作業内容**:
  - TableInstanceからプレイヤーのチップ残高を取得するメソッド追加
  - Bankrollへのクレジット処理
  - Transactionレコード作成

### 2. Redisキューのクリーンアップ
- **ファイル**: [MatchmakingPool.ts:90](server/src/modules/fastfold/MatchmakingPool.ts#L90)
- **内容**: キューからのプレイヤー削除時、Redisから完全に削除していない
- **影響**: 長時間稼働時、Redisメモリに古いデータが蓄積される可能性
- **作業内容**:
  - `removeFromQueue()` の Redis zrem 実装を完成させる
  - スキャン + 削除処理

---

## 優先度: 中（プロダクション準備）

### 3. OAuth環境変数設定
- **ファイル**: `.env` / [routes.ts](server/src/modules/auth/routes.ts)
- **内容**: Google/Discord OAuth設定が未完了
- **作業内容**:
  - Google/Discord Client ID/Secret の取得・設定
  - callbackUri の本番ドメイン対応

### 4. エラーハンドリング強化
- **対象**: WebSocket接続全般
- **作業内容**:
  - ネットワーク切断時の自動再接続
  - 不完全なトランザクションのロールバック
  - タイムアウト処理の改善

### 5. ローカルテスト環境の整備
- **作業内容**:
  - docker-compose 動作確認
  - マルチプレイヤーシミュレーション（複数ブラウザでのテスト）
  - E2Eテストの追加検討

---

## 優先度: 低（ポリッシュ・チューニング）

### 6. 管理画面のUI改善
- **ファイル**: [admin/routes.ts](server/src/modules/admin/routes.ts)
- **現状**: `/admin/status` はJSONのみ
- **作業内容**:
  - HTMLダッシュボードの作成
  - リアルタイム更新（WebSocket）

### 7. ハンド履歴の記録
- **対象**: HandHistory, HandHistoryPlayerテーブル
- **作業内容**:
  - ショーダウン後のHandHistoryテーブルへの自動保存
  - プレイヤー統計トラッキング
  - 履歴閲覧UI

### 8. Apple OAuth追加
- **現状**: Google/Discordのみ対応
- **作業内容**: Apple Sign In の実装

---

## 完了済み機能

- [x] バックエンド基盤（Fastify + TypeScript）
- [x] PostgreSQL + Prisma スキーマ設計
- [x] Redis キャッシュ・キュー実装
- [x] TableInstance（テーブル管理、ハンド進行）
- [x] MatchmakingPool（ファストフォールド）
- [x] Google/Discord OAuth2 + JWT認証
- [x] バンクロール管理（残高、日々ボーナス）
- [x] WebSocket接続・ゲーム状態同期
- [x] ボットAI（BotClient, BotManager）
- [x] フロントエンド統合（OnlineGame, SimpleLobby）

---

## 開発コマンド

```bash
# 全サービス起動
docker-compose up -d              # PostgreSQL + Redis
cd server && npm run db:push      # DBスキーマ反映
npm run dev                       # フロントエンド (localhost:5173)
npm run dev:server                # バックエンド (localhost:3001)
```

---

*最終更新: 2026-01-31*
