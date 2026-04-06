import type { RankingEntry } from '../components/RankingUtils';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  data: RankingEntry[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function fetchRankings(period: string, weekOffset = 0): Promise<RankingEntry[]> {
  const cacheKey = `${period}:${weekOffset}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const params = new URLSearchParams({ period });
  if (weekOffset > 0) params.set('weekOffset', String(weekOffset));
  const res = await fetch(`${API_BASE}/api/stats/rankings?${params}`, {
    credentials: 'include',
  });
  if (!res.ok) return [];

  const json = await res.json();
  const data: RankingEntry[] = json?.rankings ?? [];

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}
