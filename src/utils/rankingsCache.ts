import type { RankingEntry } from '../components/RankingPopup';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  data: RankingEntry[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function fetchRankings(period: string): Promise<RankingEntry[]> {
  const cached = cache.get(period);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const res = await fetch(`${API_BASE}/api/stats/rankings?period=${period}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];

  const json = await res.json();
  const data: RankingEntry[] = json?.rankings ?? [];

  cache.set(period, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
