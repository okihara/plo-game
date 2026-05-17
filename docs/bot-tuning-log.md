# Bot 調整ログ

`/morning-bot-improve` ルーティンによる Bot AI 調整の履歴。直近の変更箇所を確認して **3 日連続で同じ箇所を触らない** ためのログ。

## 2026-05-15

### 仮説
全体集計では yuna0312 が weighted -3.7 BB/100 と他 2 種（TatsuyaN -13.7 / YuHayashi -19.2）より明確に良かったが、**vs human に絞ると TatsuyaN が -40.1 BB/100 と断トツで悪く、yuna0312/YuHayashi は -25 前後で並走**。HU showdown 勝率は yuna0312 のみ 52.7% で 50% 超え。ハンド数が積もると 3 personality のパラメータ差が結果に大きく影響する。

ユーザー判断: ばらつきを抑えるため **yuna0312 を共通ベースに、TatsuyaN/YuHayashi は ±0.01〜0.03 の微小オフセットだけ残す設計変更**を実施。これは通常の「1 PR で 1〜2 箇所・±10%」ルールから外れる戦略的な集約。

### 観測（集団・直近24h, 24,179 ハンド, hands>=100 の 184 bot）

- 全体: Bot 総損益 -51,158 / Human +24,024
- Personality 別 weighted BB/100: TatsuyaN -13.7 / YuHayashi -19.2 / yuna0312 -3.7
- 対人間 BB/100: TatsuyaN **-40.1** / YuHayashi -24.5 / yuna0312 -25.7
- 対人間 HU sdWin%: TatsuyaN 47.0% / YuHayashi 49.8% / yuna0312 **52.7%**
- ポジション別中央 BB/100: BB -71.6（5/10 の position bonus 強化で -77.2 → -71.6 と微改善のみ）

### 変更
- `server/src/shared/logic/ai/personalities.ts`
  - **TatsuyaN**（やや前のめりオフセット）:
    - vpip 0.30 → **0.29**, pfr 0.22 → **0.19**, threeBetFreq 0.09 → **0.06**
    - cbetFreq 0.64 → **0.52**, aggression 0.80 → **0.63**
    - bluffFreq 0.13 → **0.09**, slowplayFreq 0.09 → **0.15**
    - foldTo3Bet 0.52 → **0.60**, foldToCbet 0.44 → **0.52**, foldToRiverBet 0.55 → **0.58**
  - **YuHayashi**（やや堅実寄りオフセット）:
    - vpip 0.25 → **0.27**, pfr 0.20 → **0.19**, threeBetFreq 0.09 → **0.06**
    - cbetFreq 0.65 → **0.52**, aggression 0.80 → **0.60**
    - bluffFreq 0.13 → **0.08**, slowplayFreq 0.12 → **0.15**
    - foldTo3Bet 0.52 → **0.62**, foldToCbet 0.45 → **0.54**, foldToRiverBet 0.55 → **0.58**
  - **yuna0312**: 据え置き（ベース）
- 影響範囲: TatsuyaN 系約 127 体 + YuHayashi 系約 127 体 = **約 254 体が大幅変更**。yuna0312 系約 128 体は据え置き

### PR
（未定）

### 評価予定
2026-05-16 以降のレポートで:
- TatsuyaN 系の対人間 BB/100 / HU sdWin% が yuna0312 系水準に近づくか
- 全体損益（Bot vs Human 総額）の推移
- 3 personality 間の BB/100 ばらつきが縮小するか
を確認。改善が見えなければ revert または再調整。

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
