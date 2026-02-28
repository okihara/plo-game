# Bot AI 戦略ドキュメント

PLO ポーカーボットの意思決定ロジックの全体像。

## アーキテクチャ概要

```
getCPUAction (cpuAI.ts)  ← エントリポイント
├── プリフロップ → getPreflopDecision (preflopStrategy.ts)
└── ポストフロップ
    ├── analyzeBoard (boardAnalysis.ts)        → ボードテクスチャ
    ├── evaluateHandExtended (handStrength.ts)  → ハンド評価
    │   ├── estimateHandEquity (equityEstimator.ts)
    │   ├── analyzeBlockers (blockerAnalysis.ts)
    │   └── analyzeRiverNuts (nutsAnalysis.ts)  ← リバーのみ
    └── getPostflopDecision (postflopStrategy.ts)
        ├── evaluateBluff / shouldBarrel (bluffStrategy.ts)
        └── decideBetSize (betSizing.ts)
```

ファイル一覧: `server/src/shared/logic/ai/`

| ファイル | 役割 |
|---|---|
| `types.ts` | 型定義 (BotPersonality, ExtendedHandEval 等) |
| `personalities.ts` | 20体のボットパーソナリティ定義 |
| `handStrength.ts` | 拡張ハンド評価（メイド+ドロー+エクイティ+ブロッカー+ナッツ分析） |
| `postflopStrategy.ts` | ポストフロップ意思決定エンジン |
| `preflopStrategy.ts` | プリフロップ意思決定 |
| `nutsAnalysis.ts` | リバーでのナッツランク算出 |
| `boardAnalysis.ts` | ボードテクスチャ分析 |
| `betSizing.ts` | ベットサイジング |
| `bluffStrategy.ts` | ブラフ戦略 |
| `equityEstimator.ts` | エクイティ推定（アウツベース） |
| `blockerAnalysis.ts` | ブロッカー分析 |
| `opponentModel.ts` | 相手モデリング（統計蓄積） |

---

## パーソナリティシステム

### 割り当てロジック

`getPersonality(botName)` でボット名のハッシュから好成績3種のいずれかを割り当て:

| パーソナリティ | タイプ | VPIP | PFR | Aggression |
|---|---|---|---|---|
| TatsuyaN | バランスやや攻撃的 | 0.30 | 0.22 | 0.80 |
| YuHayashi | バランスTAG | 0.25 | 0.20 | 0.80 |
| yuna0312 | セミTAG | 0.28 | 0.19 | 0.60 |

### パラメータ一覧

| パラメータ | 範囲 | 説明 |
|---|---|---|
| `vpip` | 0.20-0.38 | プリフロップ参加頻度 |
| `pfr` | 0.14-0.30 | プリフロップレイズ頻度 |
| `threeBetFreq` | 0.05-0.13 | 3ベット頻度 |
| `cbetFreq` | 0.50-0.75 | Cベット頻度 |
| `aggression` | 0.55-1.00 | アグレッション |
| `bluffFreq` | 0.06-0.18 | ブラフ傾向 |
| `slowplayFreq` | 0.05-0.20 | スロープレイ傾向 |
| `foldTo3Bet` | 0.40-0.70 | 3ベットに対するフォールド率 |
| `foldToCbet` | 0.35-0.60 | Cベットに対するフォールド率 |
| `foldToRiverBet` | 0.40-0.70 | リバーベットに対するフォールド率 |

---

## プリフロップ戦略 (`preflopStrategy.ts`)

### ハンド評価

`getPreFlopEvaluation()` (cpuAI.ts) でスコア0-1を算出:
- **ナッティネス**: AA +0.28, KK +0.22, Aスーテッド +0.10, 高平均ランク +最大0.15
- **コネクティビティ**: ランダウン(TJQK等) +0.35, ギャップスコア, ラップポテンシャル
- **スーテッドネス**: ダブルスーテッド +0.22, シングル +0.14, Aスーテッド追加ボーナス
- **ボーナス**: AA+KK DS +0.15, ランダウン+DS +0.08 など

ポジションボーナス: BTN +0.10, CO +0.08, HJ +0.05, BB/SB -0.05

### 判定フロー

```
effectiveStrength = score + positionBonus

1. プレミアム (> 0.75)
   → レイズ（70-90%の確率）、トラップコール

2. 4bet直面
   → 0.65+ かつ構造良好 → コール、それ以外 → フォールド

3. 3bet直面
   → ハンド構造チェック（DS, ランダウン, スーテッドラップ, ペア+スーテッド）
   → 構造不良 → 55%+でフォールド
   → 構造良好 → パーソナリティベースのフォールド率

4. 3bet判断（オープンレイズに対して）
   → threeBetFreq + ポジション補正 + 強度補正

5. 良いハンド (> pfrThreshold)
   → オープン/コール

6. 参加可能 (> vpipThreshold)
   → チェック/安いコール

7. 弱いハンド
   → チェック or スチール（BTN/COで低確率）
```

**VPIP閾値**: `max(0.10, 0.70 - personality.vpip * 1.3)`
- vpip=0.30 → 閾値0.31（約30%参加）
- vpip=0.20 → 閾値0.44（約20%参加）

**PFR閾値**: `vpipThreshold + (vpip - pfr) * 0.8`

---

## ポストフロップ戦略 (`postflopStrategy.ts`)

### 判定フロー（優先順）

```
0.  Cベット対フォールド — 弱手(rank≤2, ドロー無し) + 相手Cベット → foldToCbet
0b. リバーベット対フォールド
    - ハイカード以下 → 100% フォールド
    - ワンペア → 高確率フォールド（ベットサイズ依存）

1.  モンスターハンド
    - リバー: nutRank === 1 → playMonster
    - 非リバー: isNuts || (isNearNuts && rank >= 5) → playMonster

2.  強メイド (rank >= 3: ツーペア+) → playStrongMade
    - リバー nutRank ベースのフォールド判断（後述）

3.  Cベット — プリフロップアグレッサー + チェック状況 → evaluateCbet

4.  ドローハンド — FD/SD/ラップ → playDraw（セミブラフ検討）

5.  ワンペア → playOnePair
    - リバー大ベット → ほぼフォールド
    - フロップ/ターン → チェック/コール

6.  ブラフ検討 → evaluateBluff

7.  チェック/フォールド（デフォルト）
```

### リバー nutRank ベースのフォールド判断

`playStrongMade` 内でリバーのベットに直面した場合:

| nutRank | 条件 | フォールド確率 |
|---|---|---|
| 1 (ナッツ) | — | playMonster で処理（フォールドしない） |
| 2 (セカンドナッツ) | bet > 70% pot | `foldToRiverBet * 0.3` |
| 3 | bet > 50% pot | `min(0.70, foldToRiverBet * 0.6 + sizing補正)` |
| 4+ | bet > 40% pot | `min(0.85, foldToRiverBet * 0.9 + sizing補正)` |

エクイティがポットオッズを上回る場合にも nutRank チェック:
- nutRank 4+ & bet >= 30% pot → `min(0.80, foldToRiverBet + bet比率 * 0.3)`
- nutRank 3 & bet >= 50% pot → `min(0.60, foldToRiverBet * 0.5 + bet比率 * 0.2)`

### モンスターハンドのプレイ

```
スロープレイ判断:
  ドライボード + random < slowplayFreq → チェック/コール

それ以外:
  decideBetSize() でサイジング → バリューベット/レイズ
```

---

## ハンド評価 (`handStrength.ts`)

`evaluateHandExtended()` の出力:

| フィールド | 説明 |
|---|---|
| `strength` | 総合強度 0-1 (rank/9 + highCard補正 + ドロー補正) |
| `madeHandRank` | 1=ハイカード ... 9=ストフラ |
| `hasFlushDraw` | PLO: ホール2枚+ボードで同スート4枚 |
| `hasStraightDraw` | 4連続カード（ホール2枚使用） |
| `hasWrapDraw` | ストレートアウツ8以上 |
| `drawStrength` | ドロー強度 0-1 (ナッツFD=0.4, FD=0.25, ラップ=0.35, SD=0.2) |
| `isNuts` | ストフラ/クワッズ/トップセットFH/ナッツフラッシュ |
| `isNearNuts` | ナッツ未満だが rank>=5 & highCard>=Q |
| `estimatedEquity` | メイドハンド + ドローエクイティ (対戦人数割引) |
| `blockerScore` | ブロッカースコア 0-1 |
| `vulnerabilityToDraws` | ドローに対する脆弱性 0-1 (リバー=0) |
| `nutRank` | リバーのみ: 1=ナッツ, 2=セカンドナッツ... |
| `possibleBetterHands` | リバーのみ: 上位ハンド種別リスト |

---

## ナッツ分析 (`nutsAnalysis.ts`)

リバーでのみ実行。ボード上で理論的に可能なハンドを列挙し、自分のハンドの相対位置を算出。

### チェック順

1. **ストレートフラッシュ** — 同スート3枚以上のボードで5連続可能か
2. **クワッズ** — ボードペア/トリップス + 未使用カード2枚以下で4枚成立か
3. **フルハウス** — トリップスボード/ダブルペアボード/シングルペアボード判定
4. **フラッシュ** — 同スート3枚以上 + 未使用同スート2枚以上（自分がフラッシュならbetter_flush数もカウント、上限3）
5. **ストレート** — ボード3枚を使い2枚足してストレート成立か（自分がストレートならbetter_straight数もカウント）

`nutRank = possibleBetterHands.length + 1`

---

## ボードテクスチャ分析 (`boardAnalysis.ts`)

| プロパティ | 判定ロジック |
|---|---|
| `monotone` | 同スート3枚以上 |
| `twoTone` | 同スート2枚（3枚未満） |
| `rainbow` | 全カード異スート |
| `isPaired` | 同ランク2枚以上 |
| `isTrips` | 同ランク3枚以上 |
| `isConnected` | gap≤2の連続3枚以上 |
| `straightPossible` | = isConnected |
| `isWet` | flushDraw or flushPossible or isConnected |
| `dynamism` | 次カードでナッツが変わる可能性 0-1（リバー=0） |
| `hasBroadway` | T以上が2枚以上 |

`boardScaryness()`: フラッシュ可能 +0.3, モノトーン +0.15, ストレート可能 +0.2, ペア +0.15, コネクテッド +0.1, ウェット +0.1

---

## エクイティ推定 (`equityEstimator.ts`)

### アウツ → エクイティ変換 (`outsToEquity`)

- フロップ: `outs × 4%`（8以上は `-(outs-8)×1%` 補正）、上限65%
- ターン: `outs × 2%`
- リバー: 0

### 総合エクイティ (`estimateHandEquity`)

```
baseEquity = madeHandRankToEquity(rank)
  rank 1(ハイカード)=10%, 2(ペア)=25%, 3(ツーペア)=50%,
  4(セット)=60%, 5(ストレート)=70%, 6(フラッシュ)=78%,
  7(FH)=88%, 8(クワッズ)=95%, 9(ストフラ)=99%

drawEquity = outsToEquity(outs, street)
  ナッツドロー比率で0.7-1.0の割引

equity = base + draw * (1 - base)  // 重複回避

対戦人数割引: 3人以上 ×0.75, 2人 ×0.9
```

---

## ブラフ戦略 (`bluffStrategy.ts`)

### ブラフ種別と発動条件

| 種別 | 条件 | 基本確率 |
|---|---|---|
| **リバーブラフ** | リバー & rank≤2 | `bluffFreq + blockerScore×0.20 + ポジション + scary×0.10` |
| **セミブラフ** | ドローあり & 非リバー | ラップ: 55-70%, ナッツFD: 50-62%, FD: 30-40%, SD: 25-35% |
| **プローブベット** | 相手Cベットミス & フロップ | `bluffFreq × 1.5 + ポジション + ドライボード + HU補正` |
| **ピュアブラフ** | rank≤1 & ベットなし | `bluffFreq + ポジション + scary + blocker` |

抑制:
- ベットに直面 → ×0.4（リバー）/ ×0.6（セミブラフ）
- 大ベット直面 → さらに×0.5
- 3人以上 → ×0.3（ピュアブラフ）
- ショートスタック → ×0.3 or 不可

### バレル判断 (`shouldBarrel`)

ダブルバレル（ターン）/トリプルバレル（リバー）の継続判定:
- 前ストリートのアグレッサーでない → バレルしない
- `aggression × 0.3 + ハンド改善 + スケアカード + ブロッカー`
- リバーバレル → 確率×0.6

---

## ベットサイジング (`betSizing.ts`)

`decideBetSize()` の返り値はポット倍率（0.25-1.10）。

| 状況 | ドライボード | ウェットボード |
|---|---|---|
| Cベット | 33-50% | 65-80% |
| バリューベット | 50-65% | 75-100% |
| セミブラフ | 60-75% | 65-80% |
| ミディアムハンド | 25-35% | 30-40% |
| ブラフ | 50-65% | 60-75% |

補正:
- パーソナリティ: `(aggression - 0.7) × 0.2`
- ランダム変動: ±5%
- マルチウェイ: +10%（Cベット）
- ナッツ: +10%（バリュー）
- 低SPR: +15%（バリュー）

---

## ブロッカー分析 (`blockerAnalysis.ts`)

| ブロッカー | スコア | 判定 |
|---|---|---|
| ナッツフラッシュ | +0.35 | フラッシュ可能ボード + そのスートのA持ち |
| ナッツストレート | +0.25 | ボード最高値+1 or +2 を持つ |
| トップセット | +0.20 | ボード最高ランクを1枚持つ |
| セカンドペア | +0.10 | ボード2番目のランクを1枚持つ |

`bluffBlockerValue()`: ブラフ候補としてのブロッカー価値 (NF +0.4, NS +0.3, TS +0.2)

---

## 相手モデリング (`opponentModel.ts`)

`SimpleOpponentModel` がハンド間で統計を蓄積:

- **VPIP/PFR**: 移動平均で更新（学習率 α = min(0.1, 1/handsPlayed)）
- **アグレッション**: bet/raise vs call の比率
- **フォールド率**: 全アクション中のフォールド比率

プレイヤー分類:
| 分類 | VPIP | アグレッシブ |
|---|---|---|
| TAG | ≤30% | bets > calls |
| LAG | >30% | bets > calls |
| TP | ≤30% | bets ≤ calls |
| LP | >30% | bets ≤ calls |

ストリート別フォールド確率: `foldRate × streetMultiplier` (preflop ×0.9, flop ×1.0, turn ×1.1, river ×1.2)

---

## ボット実行基盤 (`server/src/bot/`)

### BotClient

- Socket.io でサーバーに接続、`game:action_required` を受信して AI 判定
- `buildGameStateForAI()` で ClientGameState → GameState に変換
- `maybeEarlyFold()`: 自分のターン前に AI がフォールド判断なら即 `game:fast_fold` 送信

### 思考時間

人間らしさを演出するための思考遅延:

| アクション | ベース時間 |
|---|---|
| チェック | 1,500ms |
| フォールド | 1,800ms |
| コール | 3,000ms |
| ベット/レイズ | 3,000ms |

追加遅延:
- ストリート補正: フロップ +500ms, ターン +1,000ms
- 3bet直面: +2,500ms
- リバー大ベット(≥50% pot): +3,000〜5,000ms
- オールイン: +4,000ms
- ランダム長考(12%): +3,000〜7,000ms
- 範囲: 1,200ms〜15,000ms

### BotManager

- 最大100体管理、デフォルト20体起動
- セッション上限: 80ハンドで離席 → クールダウン5分 → 新ボット補充
- ヘルスチェック: 切断ボットを自動検出・補充
