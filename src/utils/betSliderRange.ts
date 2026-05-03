/**
 * スライダーのチップ刻み: SB === 1 のみ例外で 1。それ以外は floor(SB/5)（0 になる場合は 1）。
 * 右端は常に maxRaise（ポット上限やスタックにクランプされた最大レイズ額）。
 *
 * 注: 内部 chip 値は raw (1 単位整数) で動かしている。表示倍率 (×chipUnit) は
 * formatChips が担当。slider 値もここでは raw を扱う。
 */

/** SB が 0 以下のときは 1 を返す */
export function betSliderChipStepFromSmallBlind(smallBlind: number): number {
  if (smallBlind <= 0) return 1;
  if (smallBlind === 1) return 1;
  const step = Math.floor(smallBlind / 5);
  return step >= 1 ? step : 1;
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
