/**
 * チップ量を短縮表記にフォーマットする (絶対値表示専用)。
 * K/M は常に小数 1 桁: 1000 → "1.0K", 1500 → "1.5K", 2000000 → "2.0M"。
 *
 * 注: BB 表記が必要なケースは GameSettingsContext.formatChips を経由すること。
 */
export function formatChips(amount: number): string {
  if (amount >= 100000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 100000) return `${(amount / 1000).toFixed(1)}K`;
  return String(amount);
}
