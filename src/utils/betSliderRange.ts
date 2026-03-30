/**
 * スライダーのチップ刻みは、この並びのうち「SB 以下で最大」（SB に最も近い同値かそれより小さい段）を使う。
 * 右端は常に maxRaise（ポット上限やスタックにクランプされた最大レイズ額）。
 */

export const BET_SLIDER_DENOMINATIONS = [1, 100, 500, 1000, 5000, 25000] as const;

/** SB が 0 以下のときは 1 を返す */
export function betSliderChipStepFromSmallBlind(smallBlind: number): number {
  if (smallBlind <= 0) return 1;
  let step = 1;
  for (const d of BET_SLIDER_DENOMINATIONS) {
    if (d <= smallBlind) step = d;
  }
  return step;
}

export function betSliderMaxIndex(minRaise: number, maxRaise: number, chipStep: number): number {
  const step = Math.max(1, chipStep);
  if (maxRaise <= minRaise) return 0;
  const k = Math.floor((maxRaise - minRaise) / step);
  const lastGrid = minRaise + k * step;
  return lastGrid < maxRaise ? k + 1 : k;
}

export function betSliderIndexToAmount(index: number, minRaise: number, maxRaise: number, chipStep: number): number {
  const step = Math.max(1, chipStep);
  const k = Math.floor((maxRaise - minRaise) / step);
  if (index > k) return maxRaise;
  return minRaise + index * step;
}

export function betSliderAmountToNearestIndex(
  amount: number,
  minRaise: number,
  maxRaise: number,
  chipStep: number,
): number {
  const maxIdx = betSliderMaxIndex(minRaise, maxRaise, chipStep);
  const clamped = Math.max(minRaise, Math.min(maxRaise, amount));
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i <= maxIdx; i++) {
    const a = betSliderIndexToAmount(i, minRaise, maxRaise, chipStep);
    const d = Math.abs(a - clamped);
    if (d < bestDiff) {
      bestDiff = d;
      best = i;
    }
  }
  return best;
}
