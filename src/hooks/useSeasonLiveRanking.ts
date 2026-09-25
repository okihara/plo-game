import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
// サーバー側も 60 秒キャッシュなので、タブ切替のたびに取り直さない
const CACHE_TTL_MS = 60_000;

export interface LiveRankEntry {
  position: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  totalRp: number;
  entries: number;
  wins: number;
  itm: number;
  best: number | null;
}

export interface LiveRankingMe extends LiveRankEntry {
  /** ひとつ上の順位までに必要な RP（1位なら null） */
  rpToNext: number | null;
  /** TOP N 入りに必要な RP（既に圏内なら null） */
  rpToTop: number | null;
}

/** GET /api/season/live-ranking のレスポンス（進行中シーズンの RP ランキング） */
export interface LiveRankingView {
  season: { id: number; name: string; label: string };
  tournamentsCounted: number;
  rankedPlayers: number;
  topN: number;
  top: LiveRankEntry[];
  around: LiveRankEntry[];
  me: LiveRankingMe | null;
}

const cache = new Map<string, { data: LiveRankingView; expiresAt: number }>();

async function fetchLiveRanking(userId: string | undefined): Promise<LiveRankingView | null> {
  const key = userId ?? '';
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const params = userId ? `?${new URLSearchParams({ userId })}` : '';
  const res = await fetch(`${API_BASE}/api/season/live-ranking${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as LiveRankingView;
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

/** 進行中シーズンの RP ランキング（userId 指定で本人の順位つき）を取得する */
export function useSeasonLiveRanking(userId: string | undefined): { data: LiveRankingView | null; loading: boolean } {
  const [data, setData] = useState<LiveRankingView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLiveRanking(userId)
      .catch(() => null)
      .then(json => {
        if (cancelled) return;
        setData(json);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [userId]);

  return { data, loading };
}
