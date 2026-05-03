/**
 * スライダーのチップ刻み: SB === 1 のみ例外で 1。それ以外は floor(SB/5)（0 になる場合は 1）。
 * 右端は常に maxRaise（ポット上限やスタックにクランプされた最大レイズ額）。
 *
 * トーナメント等で chipUnit が指定されたときは、step を chipUnit の倍数に切り上げる。
 * これで slider 値は常に chipUnit の倍数になり、サーバー側の分配 floor と整合する。
 */

/** SB が 0 以下のときは chipUnit を返す */
export function betSliderChipStepFromSmallBlind(smallBlind: number, chipUnit: number = 1): number {
  const u = Math.max(1, chipUnit);
  if (smallBlind <= 0) return u;
  if (smallBlind === u) return u;
  const step = Math.floor(smallBlind / 5);
  return Math.max(u, Math.ceil(step / u) * u);
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
