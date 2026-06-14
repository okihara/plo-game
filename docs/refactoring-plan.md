# 全体リファクタリング計画

2026-06 時点のコードベース調査（クライアント / サーバー / 共有パッケージ / エンジン群の4方向）に基づく、フェーズ分割されたリファクタリング計画。

## 現状サマリー

| 領域 | 規模 | 健全性 | 主な負債 |
|------|------|--------|----------|
| `src/`（クライアント） | 約12,500行 | △ | API呼び出しが17ファイルに分散、ActionPanel系の重複、巨大コンポーネント |
| `server/src/` | 約39,800行 | ○ | エンジン6種に約600〜900行のコピペ、cpuAIレガシー残存 |
| `packages/shared/` | 約1,900行 | ○ | equityCalculator がクライアント/サーバーで**別実装**（最重要） |
| その他 | - | - | `solver/`（node_modulesのみ）、使い捨てscripts、ログファイル |

調査で確認できた良い点（壊さないこと）:

- `modules/game/handlers.ts` と `TableInstance` の責務分担は CLAUDE.md 通り守られている
- Socket.io イベント・APIルートに未使用なし
- エンジン6種はすべて `VariantAdapter` 経由で現役使用中（削除候補なし）
- サーバー側エンジンテストが厚い（gameEngine 1,944行、studEngine 1,303行、drawEngine 1,068行、bombPot 705行）— Phase 2 の回帰防止網として機能する

## 進め方の原則

1. **1 PR = 1関心事**。リファクタPRに挙動変更を混ぜない
2. 各PRの完了条件: `npx tsc --noEmit`（両側）+ `cd server && npm test` + `npm run build` が通ること
3. **削除 → 一本化 → 抽出 → 分割 → リネーム** の順。リネーム（import一斉変更）は他の作業と衝突するため最後
4. エンジンに触るPRは、変更前に既存テストが対象パスをカバーしているか確認。足りなければ**先にテストを足してから**リファクタする
5. 本番はリアルタイムマルチプレイヤーなので、エンジン系PRはデプロイ後に admin の `/admin/status` とSentryを一定時間監視する

---

## Phase 0: 掃除と安全網（規模: 小 / 1〜2日）

リスクゼロの削除と、以降のフェーズを支える検出ツールの導入。

### 0-1. デッドコード・ゴミの削除

| 対象 | 根拠 |
|------|------|
| `src/components/TournamentResultOverlay.tsx` | どこからも import されていない（grep確認済み） |
| `src/components/StudActionPanel.tsx` | 2行の後方互換 re-export。参照箇所（`FixedLimitActionPanel.tsx` のコメント、`components/index.ts`）を直して削除 |
| `src/components/DrawPhasePanel.tsx` | barrel export のみで実利用なし（削除前に再確認） |
| `solver/` | 中身は node_modules のみ |
| `logs.1774787874280.log` | リポジトリ直下のログファイル |
| `server/scripts/replay-hand-g5kmub.ts` ほか特定ハンドのデバッグ用 | 一回限りの使い捨て。`postflop-*-debug.ts`、`bf-bench.ts` 等は README 記載有無を確認の上、削除か `scripts/archive/` へ |

**注意**: `VariantBadge.tsx` は調査初報で削除候補に挙がったが、`TournamentList.tsx` から使用中のため**削除しない**。削除系は必ず grep で裏取りしてから実施する。

### 0-2. 未使用コード検出の常設

- `knip`（または `ts-prune`）を devDependency に追加し、未使用 export / 未使用ファイルの一覧を取得
- 初回実行結果をこのドキュメントに追記し、Phase 0 の削除対象を確定させる
- 可能なら CI に組み込み、以降のフェーズで「消したつもりの残骸」を機械検出する

### 検証

- `npx tsc --noEmit`（ルート・server 両方）、`cd server && npm test`、`npm run build`

---

## Phase 1: 共有ロジックの一本化（規模: 中 / 2〜4日）

**最重要フェーズ**。クライアントとサーバーで同じ計算が別実装になっており、結果が乖離しうる箇所を `packages/shared` に一本化する。

### 1-1. equityCalculator の統一【最優先】

現状、エクイティ計算が2つ存在し実装が異なる:

- `src/logic/equityCalculator.ts`（376行）: Monte Carlo 500回、5枚評価関数 `evaluateFiveCardHandForNuts` を**ローカルに手書き**
- `server/src/shared/logic/equityCalculator.ts`（234行）: 完全列挙 + Monte Carlo 2000回の併用、`@plo/shared` の評価関数を使用

同じ局面でクライアント表示とサーバー計算（オールインEV等）がズレるバグの温床。

手順:

1. `packages/shared/src/equityCalculator.ts` を新設。サーバー実装（精度が高い方）をベースに移植し、`calculateEquities` / `calculateAllInEVProfits` を export
2. クライアント固有のアウツ分析（`calculateOuts`）は、共有の5枚評価関数を使う形に書き換えて同居 or クライアントに残すか判断
3. `server/src/shared/logic/equityCalculator.ts` → re-export 化ののち削除
4. `src/logic/equityCalculator.ts` → 削除し `@plo/shared` から import
5. オールインEV worker（worker_threads 側）の import パスも追従

検証: 既存のエンジンテストに加え、**移行前後で同一入力に対する equity 出力を突き合わせる比較テスト**を一時的に書く（許容誤差つき。Monte Carlo はシード固定 or 完全列挙ケースで比較）

### 1-2. プリフロップ評価の統合

- `packages/shared/src/preflopEquity.ts` は PLO4 専用、PLO5 は `server/src/shared/logic/ai/preflopEvaluatorPLO5.ts` のヒューリスティックと二本立て
- PLO5 評価を `packages/shared` に移し、`getPreFlopEvaluation` を variant 分岐で一本化（既存docs `preflop-hand-evaluation.md` も追従更新）

### 1-3. re-export プロキシの整理

- `server/src/shared/logic/{deck,handEvaluator,types,preflopEquity}.ts` は `@plo/shared` への単なる re-export。サーバー内の import を `@plo/shared` 直参照へ置換し、プロキシファイルを削除
- `src/logic/{deck,handEvaluator,types}.ts` も同様
- 機械的な置換なので1PRで完結させる

### 1-4. hiLoSplitPot の配置判断

- `server/src/shared/logic/hiLoSplitPot.ts`（161行）はクライアントのハンド履歴表示で Hi-Lo 分配を再現する必要が出たら `packages/shared` へ。現状サーバーのみなら据え置き（このフェーズでは判断だけ記録）

---

## Phase 2: サーバーエンジン群の共通コア抽出（規模: 大 / 1〜2週間）

6エンジン（gameEngine / limitHoldem / omahaHiLo / stud / draw / bombPot、計約4,600行）に約600〜900行のコピペがある。テストが厚いので安全に進められるが、**ゲーム進行の核心**なので最も慎重に。

### 2-1. ヘルパー関数の統一（小・先行PR）

`server/src/shared/logic/engineHelpers.ts` を新設し、4〜5エンジンに同一実装で存在する以下を集約:

- `getNextActivePlayer(state, fromIndex)` — limitHoldem / omahaHiLo / draw / stud に重複
- `getActivePlayerCount(state)` — 5エンジンに重複
- `getNextPlayerWithChips(state, fromIndex)` — limitHoldem / omahaHiLo に重複

効果は約100行だが、後続PRの足場になる。

### 2-2. アクション処理コアの抽出（中）

各エンジンの `applyXxxAction()` は fold / check / call / all-in 処理が6エンジンで同一、bet / raise だけが No-Limit / Fixed-Limit で異なる。

- `applyActionCore(state, playerIndex, action, amount)` を engineHelpers に抽出（共通の switch 骨組み）
- bet/raise の差分（`minRaise` 動的更新 vs `betCount`++ + 固定額）はコールバックまたは構造体パラメータで注入
- **1エンジンずつ別PRで移行**し、各PRでそのエンジンのテストスイートをグリーンに保つ。順序は テストが最も厚い gameEngine → stud → draw → limitHoldem → omahaHiLo → bombPot

効果: 約300〜480行削減

### 2-3. ショーダウン処理の共通フレーム化（大・本丸）

各エンジンの `determineXxxWinner()` は「1人勝ち判定 → ランアウト → calculateSidePots → レーキ計算・比例配分 → ハンド評価 → チップ分配」の骨組みが80%共通。

- `determineWinnerFramework(state, evaluateFn, runOutHandler?, rakePercent, rakeCapBB)` を抽出し、バリアント固有部分（PLO評価 / Holdem評価 / Hi-Lo分割 / Stud残カード配布 / bombPot複数ボード）を注入関数にする
- Hi-Lo 系は既存の `hiLoSplitPot.ts` / `resolveHiLoShowdown` を注入点として再利用
- これも**1エンジン1PR**。レーキ・サイドポット分配はお金に直結するため、移行前に「複雑なサイドポット + レーキ + 端数」のケースがテストにあるか確認し、なければ先に追加

効果: 約500〜800行削減

### 2-4. VariantAdapter のインターフェース化（任意・後回し可）

現在の `VariantAdapter` は if/switch 分岐の集約点として実用的に機能している。2-1〜2-3 完了後、各エンジンを `PokerEngine` インターフェース（`createGameState` / `startHand` / `getValidActions` / `applyAction` / `determineWinner`）の実装に揃えると、新バリアント追加が「ファイル1個 + 登録1行」になる。**費用対効果を見て実施判断**（やらなくても 2-1〜2-3 の価値は成立する）。

### 2-5. cpuAI.ts のレガシーパス削除

- `cpuAI.ts`（506行）の `legacyGetCPUAction` 系は、新AI（`ai/strategyRegistry.ts` + variant 戦略）が全バリアントをカバーしているか確認の上で削除
- `context` なし呼び出しが残っている箇所を grep し、すべて `AIContext` 付きに移行してからレガシー分岐を落とす

---

## Phase 3: クライアントの整理（規模: 中〜大 / 1〜2週間）

サーバーと独立して進められるので、Phase 1 完了後は Phase 2 と並行可。

### 3-1. API クライアント層の導入（先行・効果大）

- `API_BASE` / `import.meta.env.VITE_API_*` の定義が **17ファイル** に分散
- `src/api/client.ts`（fetch ラッパ: credentials、エラーハンドリング、JSON変換を一元化）と `src/api/endpoints.ts` を新設
- 1PRで client 導入 + 2〜3ファイル移行、以降は数ファイルずつ機械的に移行

### 3-2. WebSocket イベント名の二重管理解消

- `src/services/websocket.ts`（472行）でイベント名文字列と `WsListeners` 型が二重管理
- `packages/shared/src/protocol.ts` の `ServerToClientEvents` を single source of truth とし、イベント → リスナーのマッピングを型から導出する形に書き換え
- イベント名のタイポをコンパイルエラーで検出できるようになる

### 3-3. ActionPanel 系の統合

- `NoLimitActionPanel.tsx`（190行）/ `FixedLimitActionPanel.tsx`（166行）/ `DrawPhasePanel.tsx`（54行）を `ActionPanel` にベット構造（no-limit / fixed-limit）の分岐として統合
- 直近の修正（再接続時の ActionPanel 再マウントと actionSent 初期化）の挙動を壊さないよう、該当PR (#178) の意図を保持すること

### 3-4. 巨大コンポーネントの分割

| 対象 | 行数 | 分割軸 |
|------|------|--------|
| `HandDetailDialog.tsx` | 824 | `HandDetail/` フォルダ化: ActionHistory / ResultSection / PlayerRow / StreetHeader |
| `TournamentList.tsx` | 669 | `Tournament/` フォルダ化: TournamentCard / WeekPager |
| `useOnlineGameState.ts` | 553 | イベント購読の登録部と state 変換ロジック（純関数）を分離。変換部はテスト可能に |
| `GameTable.tsx` | 407 | テーブル領域 / アクション領域 / 情報バー |
| `ProfilePopup.tsx` | 374 | Stats / Badges のセクション分離 |

分割は**見た目の変化ゼロ**が条件。`docs/ui-mobile-layout.md` の cqw レイアウト前提を崩さない。

### 3-5. 共通UIプリミティブ（任意）

- Dialog / Popup 系（AlertDialog, ProfilePopup, RankingPopup, HandDetailDialog）の共通ラッパ
- 全画面ステータス系（Connecting / SearchingTable / Busted）の `Screen` 統合
- カラーテーマはメモリの設計仕様（cream/forest パレット、cream-600以下の薄文字禁止）に従う

---

## Phase 4: 構造・命名の最終整理（規模: 小〜中 / 2〜3日）

すべての実体移動が終わってから行う機械的リネーム。

- `server/src/shared/logic/` → `server/src/engine/` へリネーム（Phase 1-3 で「shared なのにサーバー専用」という嘘が確定するため）。import 一斉置換、`tournamentBot.ts` や scripts の参照も追従
- `server/scripts/` の整理: README の分類を維持しつつ、使い捨て済みを `archive/` へ。以後「特定ハンドのデバッグスクリプトは作業後に削除」を運用ルール化
- CLAUDE.md / docs の地図（コードの置き場、Bot AI、preflop評価）を新構造に合わせて更新

---

## やらないこと（明示）

- **TableInstance / TournamentInstance の統合**: 調査の結果、TournamentInstance はハンド進行を TableInstance に委譲済みで、見かけの重複（着席・降座）は責務レベルが異なる正当な二層化。無理に統合すると複雑化する
- **エンジンの削除**: 6エンジンすべて現役。Bomb Pot 含め削除候補なし
- **Prisma アクセスの抽象化層（Repository層）導入**: 現状、各モジュールが責務範囲内で直接使っており違反なし。層を足すのは過剰設計
- **index.ts の分割**: 349行で既に適正

## 全体スケジュールとマイルストーン

| Phase | 内容 | 規模 | 依存 |
|-------|------|------|------|
| 0 | 掃除 + knip導入 | 1〜2日 | なし |
| 1 | 共有ロジック一本化（equity最優先） | 2〜4日 | Phase 0 |
| 2 | エンジン共通コア抽出 | 1〜2週間 | Phase 1 |
| 3 | クライアント整理 | 1〜2週間 | Phase 1（2と並行可） |
| 4 | リネーム・docs更新 | 2〜3日 | Phase 1〜3 |

成功指標:

- 重複実装ゼロ: equity / preflop評価 / エンジンヘルパーが single source of truth に
- 削減行数: 削除約1,000行 + 共通化約1,000〜1,400行（サーバー4,600行のエンジン群から13〜20%減）
- 800行超のファイルをテストファイル以外で撲滅（現状: TableInstance 1,337 / TournamentInstance 1,134 / BotClient 1,061 / gameEngine 877 / postflopStrategy 841 / HandDetailDialog 824 / drawEngine 810）
- knip による未使用 export 検出が CI で 0 件
