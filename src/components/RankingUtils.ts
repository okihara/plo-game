export interface RankingEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  isBot: boolean;
  handsPlayed: number;
  totalAllInEVProfit: number;
  winCount: number;
}

export function ordinalSuffix(n: number): string {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

export function formatProfit(value: number): string {
  const formatted = Math.abs(value).toLocaleString();
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}
