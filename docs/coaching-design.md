# コーチング機能 設計メモ

「このアプリでコーチングをしたい」という要望に対する、現状の棚卸しと実装方針の検討。
**まだ要望の中身（誰が誰を、リアルタイムか事後か）が確定していないため、本ドキュメントは選択肢の提示まで。**

## 1. 「コーチング」の想定シナリオ

要望として考えられるのは大きく 4 つ。必要な実装がかなり違う。

| # | シナリオ | 具体例 |
|---|---|---|
| A | **ライブ指導** | コーチが生徒の卓を観戦し、生徒の手札が見える状態で通話しながら指導 |
| B | **事後レビュー** | 生徒がセッション/トナメの履歴をコーチに渡し、コーチがハンドごとにコメント |
| C | **AI コーチ** | 既存のトナメ AI 評価をリング戦・単ハンドへ拡張 |
| D | **合同卓** | コーチと生徒（＋受講生）だけのプライベート卓で一緒にプレイ |

## 2. 現状の資産（すでにあるもの）

コーチングに転用できる部品はかなり揃っている。

### 観戦モード
- `handleSpectateJoin` / `handleSpectateLeave`（`server/src/modules/game/handlers.ts`）
  — `connectionMode: 'spectate'` の接続のみ観戦可。レート制限あり。
- `TableInstance.addSpectator()` — 1 卓あたり最大 50 人（`TABLE_CONSTANTS.MAX_SPECTATORS_PER_TABLE`）。Fast fold 卓は観戦不可。
- クライアント: `/watch/:tableId`（`src/pages/WatchGame.tsx`）＋ `useSpectatorGameState`。
  トーナメントは `?tournament=` で卓を前後移動できる。
- **全員のホールカードを見られるのは `odRole === 'ADMIN'` のみ**
  （`TableInstance.emitHoleCardsToSpectators()` / `sendCurrentHoleCardsToSpectator()`）。
  一般の観戦者は裏面のみ。`SpectatorAllHands` は届いた `holeCardsBySeat` を並べて表示する UI。

### ハンド履歴 / 共有
- 保存: `HandHistoryRecorder`（認証済みユーザーのみ、guest/bot は除外）。
- 自分用 API: `GET /api/history`, `GET /api/history/:handId`。
- **公開シェアリンク**: `GET /api/hand/:handId?t=<token>`（認証不要）。
  `generateShareToken(handId, seatIndex, secret)` = HMAC で **1 席分だけ**ホールカードと名前を開示、
  他プレイヤーはマスクされる（`server/src/shared/utils.ts`）。
- UI: `HandHistory.tsx` / `HandDetailPage.tsx` / `HandDetailDialog.tsx`。

### AI 評価（既にコーチ役をしている）
- `server/src/modules/tournamentEvaluation/` — 完了トーナメント 1 つ分の全ハンドを
  PokerStars 形式テキスト（`toPokerStarsHandText`）に変換して LLM に投げ、日本語 Markdown の講評を返す。
- システムプロンプトは「PLO のトーナメントコーチ」。PLO の 2 枚 + 3 枚ルールを厳格に守らせる指示入り。
- クォータ: **JST 1 日 1 回**（`User.tournamentEvalConsumedJstDate`）。
- 結果は `TournamentUserEvaluation` に保存、UI は `TournamentEvaluationPopup`。

### その他
- ハンド中の補助表示: `HandAnalysisOverlay`（プリフロップスコア、アウツ、役）。
- スタッツ: `computeStats` / `GET /api/stats/:userId` / `PlayerStatsPanel`, `ProfilePopup`。

## 3. 足りないもの（ギャップ）

1. **席単位のホールカード可視性がない** — 「この観戦者にはこの席だけ見せる」という概念がなく、
   ADMIN 全開示 / 一般全非開示の二択。
2. **他人の卓を見つける導線がない** — リング戦は `tableId` を知らないと `/watch/:id` に行けない。
   卓一覧は admin ダッシュボードのみ。
3. **フレンド／コーチ関係のモデルがない** — Prisma に friend/follow 相当なし。`Role` は `ADMIN | GUEST | PLAYER` のみ。
4. **共有はハンド単位のみ** — セッションやトーナメントをまとめて渡す仕組みがない。
5. **コメント機能がない** — ハンドに紐づくメモ/コメントのモデルがない。
6. **チャットがない** — 卓内・観戦者間のテキストチャットは未実装（通話は Discord 等の外部前提で良いと思われる）。
7. **プライベート卓がない** — `TableManager.createTable()` はブラインド/バリアント条件でのマッチメイキング専用。
   招待コード・参加制限の概念なし。

## 4. 実装案

### 案 A: コーチ観戦（ライブ指導）
**中核は「席単位のホールカード可視性」への一般化。**

- サーバ
  - `TableInstance` の観戦者を `Map<socketId, { socket, visibleSeats: 'all' | Set<number> }>` に変更し、
    `emitHoleCardsToSpectators` / `sendCurrentHoleCardsToSpectator` を `visibleSeats` で分岐。
    ADMIN は `'all'` を渡すだけになり、既存挙動は維持（開放閉鎖原則）。
  - 生徒が発行した観戦許可の検証。最小実装は **HMAC トークン**（`generateShareToken` と同じ発想で
    `odId:expiresAt` を署名）。DB を増やさずに済み、失効は期限で担保できる。
    永続的な「コーチ登録」が要るなら `CoachGrant` モデル（studentUserId / coachUserId / 期限）を追加。
  - `table:spectate_join` に `coachToken` を追加し、トークンの生徒が着席している席のみ `visibleSeats` に入れる。
- クライアント
  - 生徒側: 設定に「コーチ観戦リンクを発行」。`/watch/live?c=<token>` を渡す。
  - コーチ側: トークンから **生徒が今いる卓へ自動追従**（FastFold・卓移動・トナメ卓ブレイクで tableId が変わるため、
    tableId 直指定ではなく odId → 現在卓の解決が必須。`TableManager.playerTables` を使う）。
  - 表示は `SpectatorAllHands` を流用（生徒の席だけ表になる）。
- 注意
  - **不正利用リスク**: 生徒本人が別デバイスで自分の手札を覗くのは無害だが、
    「対戦相手にトークンを渡す」ことはできない設計にする（開示は発行者の席のみ、他席は常に裏）。
  - Fast fold 卓は現状観戦不可。ライブ指導の対象にするなら別途対応が必要。

**規模感: 中。** サーバ 1 ファイル（TableInstance）＋ handlers ＋ トークン発行 API ＋ クライアント 1 画面。

### 案 B: セッションレビュー（事後コーチング）
- 共有トークンを **ハンド単位からセッション単位へ拡張**。
  `generateShareToken` を汎用化し、`{ scope: 'hand' | 'tournament' | 'session', id, seatOrUserId }` を署名する
  共通ユーティリティにまとめる（現行のハンド共有もこれに寄せる = DRY）。
- `GET /api/shared/session/:token` — 対象期間のハンド一覧＋自席のみ開示。既存のマスク処理を再利用。
- ハンドコメント: `HandComment`（handId / authorUserId / body / createdAt）を追加し、
  `HandDetailDialog` にスレッド表示。コーチが指摘を残し、生徒が後から読む。
- **既存のトナメエクスポート（`GET /api/history/tournaments/:id/export`）で PokerStars 形式テキストが出せるので、
  「まずはテキストを書き出してコーチに渡す」だけなら追加実装ほぼゼロ**で今日から運用できる。

**規模感: 小〜中。** 共有トークン汎用化が本体。コメントを入れると DB マイグレーション込みで中。

### 案 C: AI コーチ拡張
- 既存 `tournamentEvaluation` の構造（キュー/クォータ/保存/表示）をそのまま横展開できる。
  - **単ハンド評価**: ハンド詳細に「AI に聞く」。入力が 1 ハンドなのでコストが小さく、クォータを緩められる。
  - **リング戦セッション評価**: 直近 N ハンドをまとめて講評。
- 実装上は `tournamentEvaluation` を `evaluation` モジュールに一般化し、
  「対象ハンドの取得」だけをストラテジ差し替えにするのが素直（依存性逆転）。
- コストは LLM 課金に直結するので、クォータ設計を先に決める必要あり。

**規模感: 小〜中（既存の型に嵌める限り）。**

### 案 D: プライベート卓
- `TableManager.createTable()` に `visibility: 'public' | 'invite'` と招待コードを追加し、
  マッチメイキングの探索対象から除外（`findTableByCondition`）。
- `matchmaking:join` とは別に `table:join_by_code` を追加。
- 参加者が揃わないと始まらない・Bot をどう扱うか等、運用の設計が必要。

**規模感: 中〜大。** テーブル生成・マッチメイキング・ロビー UI に広く触る。

## 5. 推奨する進め方

1. **まず要望の中身を確認する。** A（ライブ）と B（事後）で作るものがまったく違う。
2. どのシナリオでも効く共通基盤は次の 2 つ。先に手を付けるならここ。
   - **席単位のホールカード可視性**（案 A の中核。観戦の権限モデルが `ADMIN or not` から抜けられる）
   - **共有トークンの汎用化**（案 B の中核。現行のハンド共有もここに集約できて DRY）
3. 即日運用できる回避策として、**トナメエクスポートのテキストを手渡し**する運用を先に案内できる。

## 6. 未確定事項

- コーチは運営側の人（= ADMIN 権限を渡せる）か、一般ユーザーか。
  → ADMIN で足りるなら案 A はほぼ実装不要（既に全席見える）。**ここが最大の分岐点。**
- 対象はリング戦かトーナメントか、両方か。
- 有料コーチングの決済・時間管理までアプリに載せるのか、指導の場だけ提供するのか。
- 生徒の同意・プライバシー（他プレイヤーのホールカードは絶対に見せない前提で良いか）。
- 同時視聴人数の想定（現状 1 卓 50 人上限）。
