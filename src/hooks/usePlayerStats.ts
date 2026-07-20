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
  const [profitTotalHands, setProfitTotalHands] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || userId.startsWith('bot_')) return;

    setLoading(true);
    // profit-history はスタッツ本体と分離して取得する。
    // 片方が遅延・失敗してもスタッツ表示を道連れにしない。
    fetch(`${API_BASE}/api/stats/${userId}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .catch(() => null)
      .then(statsData => {
        if (statsData?.stats) setStats(statsData.stats);
        if (statsData?.tournamentStats) setTournamentStats(statsData.tournamentStats);
        if (statsData?.badges) setBadges(statsData.badges);
      })
      .finally(() => setLoading(false));

    if (withProfitHistory) {
      fetch(`${API_BASE}/api/stats/${userId}/profit-history`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null)
        .then(historyData => {
          if (historyData?.points) setProfitHistory(historyData.points);
          if (typeof historyData?.totalHands === 'number') setProfitTotalHands(historyData.totalHands);
        });
    }
  }, [userId, withProfitHistory]);

  return { loading, stats, tournamentStats, badges, profitHistory, profitTotalHands };
}
