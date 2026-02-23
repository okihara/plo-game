# All-in EV 収支スタッツ実装計画

## Context
オールインコール後のボードランアウトでは運の要素が大きい。各プレイヤーのエクイティ（勝率）に基づく期待収支（All-in EV）を計算・記録することで、実力をより正確に測れるスタッツを提供する。

## 概要
- オールインランアウト発生時にサーバー側でエクイティを計算し、EV利益を算出
- `HandHistoryPlayer.allInEVProfit` としてDB保存（null = 非オールインハンド → 実利益と同値）
- `PlayerStatsCache.totalAllInEVProfit` で累積管理（`allInEVProfit ?? profit` で加算）
- ProfilePopup に「EV Profit」として表示、ProfitChart に EV ラインを追加

## 変更ファイル一覧

### 1. `server/prisma/schema.prisma` — DBスキーマ追加
- `HandHistoryPlayer` に `allInEVProfit Int?` を追加
- `PlayerStatsCache` に `totalAllInEVProfit Int @default(0)` を追加
- マイグレーション後、既存データは `UPDATE "PlayerStatsCache" SET "totalAllInEVProfit" = "totalProfit"` で初期化

### 2. `server/src/shared/logic/equityCalculator.ts` — 新規作成
PLOマルチプレイヤーエクイティ計算エンジン:
- `calculatePotEquities(communityCards, players, deadCards)` → `Map<playerId, equity>`
- 残り1-2枚: 完全列挙（高速・正確）
- 残り3枚以上: Monte Carlo 2000回（プリフロップ全員オールイン等）
- 内部で `evaluatePLOHand()` + `compareHands()` を使用
- サイドポットごとに eligible プレイヤーのエクイティを個別計算

### 3. `server/src/modules/table/TableInstance.ts` — EV計算トリガー
`handleAction()` 内、オールインランアウト検出時（`finalCardCount > previousCardCount`）:
1. `communityCards.slice(0, previousCardCount)` でランアウト前ボードを復元
2. `calculateSidePots()` でサイドポット構造を取得
3. 各ポットの eligible プレイヤーについてエクイティ計算
4. `evProfit = evWinnings - totalBetThisRound` で各プレイヤーのEV利益算出
5. `historyRecorder.setAllInEVProfits(evProfits)` でレコーダーに渡す
6. `advanceToNextPlayer()` パスにも同様の検出を追加

### 4. `server/src/modules/table/helpers/HandHistoryRecorder.ts` — EV保存
- `private allInEVProfits: Map<number, number> | null` を追加
- `setAllInEVProfits()` / `getStartChips()` メソッド追加
- `recordHandComplete()` で `allInEVProfit` をプレイヤーレコードに含めてDB保存
- `updatePlayerStats()` に `allInEVProfits` を渡す

### 5. `server/src/modules/stats/updateStatsIncremental.ts` — インクリメンタル更新
- `StatsIncrement` に `totalAllInEVProfit` 追加
- `computeIncrementForPlayer()` に `allInEVProfit` 引数追加: `allInEVProfit ?? profit`
- `updatePlayerStats()` シグネチャに `allInEVProfits` 追加
- upsert で `totalAllInEVProfit` をインクリメント

### 6. `server/src/modules/stats/computeStats.ts` — PlayerStats型
- `PlayerStats` インターフェースに `totalAllInEVProfit: number` 追加
- `computeStats()` で `HandData.players[].allInEVProfit` を累積計算

### 7. `server/src/modules/stats/routes.ts` — API
- スタッツ API: `totalAllInEVProfit: cache.totalAllInEVProfit` を追加
- 収支推移 API: `allInEVProfit` を select に追加、累積 EV (`e`) をレスポンスに追加

### 8. `src/components/ProfilePopup.tsx` — UI表示
- `PlayerStats` に `totalAllInEVProfit` 追加
- Profit の隣に `EV Profit` を表示（同じ formatProfit + 色分け）
- `statInfo` にツールチップ説明追加

### 9. `src/components/ProfitChart.tsx` — グラフ
- `Point` に `e: number` 追加
- EV ライン（ゴールド色 `#FFB800`）を Total の下に追加

## EV計算の公式
```
各ポットについて:
  evShare = equity × potAmount  (uncontested pot は equity=1.0)

evWinnings = Σ evShare (全ポット)
evProfit = evWinnings - totalBetThisRound
```
非オールインハンド: `allInEVProfit = null` → スタッツでは `profit` を使用

## エクイティ計算アルゴリズム

### 手法選択（残りカード枚数による）
| 残りカード | 手法 | 計算量 (6人PLO) | 推定時間 |
|-----------|------|----------------|---------|
| 1枚 (ターンAI) | 完全列挙 | ~28通り × 6人 × 60combo | <5ms |
| 2枚 (フロップAI) | 完全列挙 | ~378通り × 6人 × 60combo | ~50ms |
| 3-5枚 (プリフロップ等) | Monte Carlo 2000回 | 2000 × 6人 × 60combo | ~200ms |

### PLO特有の考慮事項
- PLOルール: ホールカード4枚から必ず2枚、コミュニティカード5枚から必ず3枚使用
- 各プレイヤーあたり C(4,2) × C(5,3) = 60通りの組み合わせを評価
- デッドカード: ポットに参加していないプレイヤーのカードもデッキから除外

## エッジケース
- **フォールド済みプレイヤー**: `allInEVProfit = null`（実利益と同値扱い）
- **全員フォールドで1人残り**: オールインランアウトではないので EV計算不要
- **uncontested ポット（サイドポットで対象者1人）**: equity=1.0 として全額配分
- **端数処理**: `Math.round()` でEV利益を整数化
- **リバーオールイン**: 残りカード0枚なので EV=実利益（`finalCardCount == previousCardCount`）

## 検証方法
1. `cd server && npx prisma migrate dev --name add-allin-ev-profit`
2. `cd server && npx tsc --noEmit` — TypeScriptエラーなし
3. `cd server && npm test` — 既存テスト通過
4. `npm run build` — フロントエンドビルド成功
5. 実際にゲームでオールインを発生させ:
   - サーバーログで EV 計算結果を確認
   - `/api/stats/:userId` で `totalAllInEVProfit` が返ること確認
   - ProfilePopup に EV Profit が表示されること確認
   - ProfitChart に EV ラインが表示されること確認
