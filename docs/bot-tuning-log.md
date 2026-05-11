# Bot 調整ログ

`/morning-bot-improve` ルーティンによる Bot AI 調整の履歴。直近の変更箇所を確認して **3 日連続で同じ箇所を触らない** ためのログ。

## 2026-05-10

### 仮説
ポジション別の中央 BB/100 が全 personality で BB だけ突出して赤字（TatsuyaN -37 / YuHayashi -82 / yuna0312 -53）。`getPositionBonus` の BB ペナルティ -0.05 は SB と同じ値で、BB 防衛の call レンジが構造的に広すぎる可能性。BB ペナルティだけ少し強める。

### 観測（集団・直近24h, 20,671 ハンド, hands>=100 の 251 bot）

- 全体: Bot 総損益 -40,743 / Human +16,257（昨日 -52,549 / +25,889 から軽い改善）
- ベスト10 vs ワースト10: WSD +19.8, AFq +17.1, Cbet +4.9, F→Cbet -7.5。VPIP/PFR/3Bet/WTSD はほぼ同等
- Personality 別 平均 BB/100 (中央 WSD%):
  - TatsuyaN: -21.4 (60.6) — foldToRiverBet 0.50→0.55 適用済み
  - YuHayashi: -19.1 (60.4) — foldToRiverBet 0.50→0.55 適用済み
  - yuna0312:  -18.6 (60.5) — 据え置き
  - 3 personality がほぼ同水準に収束（昨日の差は消失）
- Personality × Position 中央 BB/100:
  - BB: TatsuyaN -37 / YuHayashi -82 / yuna0312 -53
  - SB: -29 / -28 / -31
  - BTN/CO/MP/EP はほぼ ±20 以内

### 変更
- `server/src/shared/logic/cpuAI.ts`
  - `getPositionBonus('BB')`: -0.05 → -0.07 (-40% より強いペナルティ)
- 効果: BB facing raise 時の `effectiveStrength > vpipThreshold` 判定が一段厳しくなり、marginal hand の call レンジが約 0.02 ぶん狭まる。BB 自由チェックや postflop 計算自体には影響なし
- 影響範囲: 全 bot 382 体（全 personality 共通）。ただし変更が効くのは BB ポジション限定

### PR
#139

### 評価予定
2026-05-11 以降のレポートで全 personality の BB position 中央 BB/100 と全体損益を確認。BB が改善し全体損益が悪化していなければ成功。逆に悪化していたら revert。

## 2026-05-09

### 仮説
ベスト10 vs ワースト10 の最大差は postflop（WSD +21.8, AFq +10.9）で、preflop メトリクスはほぼ同じ。3 personality 中で `foldToRiverBet` が高い yuna0312 (0.58) のみ平均 BB/100 がマシで、中央 WSD も他より高い → river で弱い手を call して負けている可能性が高い。

### 観測（集団・直近24h, 22,350 ハンド, hands>=100 の 274 bot）

- 全体: Bot 総損益 -52,549 / Human +25,889 / BB/100 中央値 -21.0
- ベスト10 vs ワースト10:
  - WSD 70.5% vs 48.7% (**+21.8**)
  - AFq 58.1% vs 47.2% (**+10.9**)
  - VPIP / PFR / 3Bet / Cbet はほぼ同じ
- Personality 別 平均 BB/100:
  - yuna0312: -10.9 (foldToRiverBet=0.58, 中央 WSD 62.5)
  - TatsuyaN: -19.1 (foldToRiverBet=0.50, 中央 WSD 58.8)
  - YuHayashi: -26.4 (foldToRiverBet=0.50, 中央 WSD 59.7)
- ポジション別中央 BB/100: BB **-77.2**, SB -25.2, BTN -7.2, CO -4.6, MP +0.9, EP +1.0

### 変更
- `server/src/shared/logic/ai/personalities.ts`
  - TatsuyaN.foldToRiverBet: 0.50 → 0.55 (+10%)
  - YuHayashi.foldToRiverBet: 0.50 → 0.55 (+10%)
- 影響範囲: TatsuyaN 系 約 91 体 + YuHayashi 系 約 100 体 = **約 191 体**。yuna0312 系 83 体は据え置き（対照群）

### PR
#134

### 評価予定
2026-05-10 以降のレポートで TatsuyaN/YuHayashi 系の平均 WSD・BB/100 を yuna0312 系と比較。改善が見えれば次の改善へ。逆に悪化していたら revert。
