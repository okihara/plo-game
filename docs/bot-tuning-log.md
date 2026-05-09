# Bot 調整ログ

`/morning-bot-improve` ルーティンによる Bot AI 調整の履歴。直近の変更箇所を確認して **3 日連続で同じ箇所を触らない** ためのログ。

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
（後追記）

### 評価予定
2026-05-10 以降のレポートで TatsuyaN/YuHayashi 系の平均 WSD・BB/100 を yuna0312 系と比較。改善が見えれば次の改善へ。逆に悪化していたら revert。
