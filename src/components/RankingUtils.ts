export interface RankingEntry {
  userId: string;
  username: string;
  avatarUrl: string | null;
  isBot: boolean;
  handsPlayed: number;
  totalAllInEVProfit: number;
  winCount: number;
}

export function formatProfit(value: number): string {
  const formatted = Math.abs(value).toLocaleString();
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}
