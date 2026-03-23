/**
 * チップ量を短縮表記にフォーマットする
 * 例: 1500 → "1.5K", 2000000 → "2M", 500 → "500"
 */
export function formatChips(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  return String(amount);
}
