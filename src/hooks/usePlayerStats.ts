import { useEffect, useState } from 'react';
import type { PlayerStatsDisplay } from '../components/PlayerStatsPanel';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export interface DisplayBadge {
  category: string;
  type: string;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
  count: number;
  /** 順位付きバッジ（シーズンTOP10など）の順位。順位を持たないバッジは省略。 */
  rank?: number;
  awardedAt: string;
}

export interface ProfitHistoryPoint {
  p: number;
  c: number;
  s: number;
  n: number;
  e: number;
}

/**
 * プレイヤーのスタッツ（キャッシュ/トナメ）・バッジ・収支推移を取得する。
 * bot / userId なしの場合は何も取得しない。
 */
export function usePlayerStats(
  userId: string | undefined,
  options: { withProfitHistory?: boolean } = {},
) {
  const { withProfitHistory = false } = options;
  const [stats, setStats] = useState<PlayerStatsDisplay | null>(null);
  const [tournamentStats, setTournamentStats] = useState<PlayerStatsDisplay | null>(null);
  const [badges, setBadges] = useState<DisplayBadge[]>([]);
  const [profitHistory, setProfitHistory] = useState<ProfitHistoryPoint[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || userId.startsWith('bot_')) return;

    setLoading(true);
    const fetches: Promise<any>[] = [
      fetch(`${API_BASE}/api/stats/${userId}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
    ];
    if (withProfitHistory) {
      fetches.push(
        fetch(`${API_BASE}/api/stats/${userId}/profit-history`, { credentials: 'include' })
          .then(res => res.ok ? res.json() : null)
          .catch(() => null),
      );
    }
    Promise.all(fetches).then(([statsData, historyData]) => {
      if (statsData?.stats) setStats(statsData.stats);
      if (statsData?.tournamentStats) setTournamentStats(statsData.tournamentStats);
      if (statsData?.badges) setBadges(statsData.badges);
      if (historyData?.points) setProfitHistory(historyData.points);
    }).finally(() => setLoading(false));
  }, [userId, withProfitHistory]);

  return { loading, stats, tournamentStats, badges, profitHistory };
}
