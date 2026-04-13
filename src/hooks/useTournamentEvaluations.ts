import { useCallback, useState } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export interface TournamentEvalQuota {
  timezone: string;
  jstDate: string;
  canGenerateToday: boolean;
  llmConfigured: boolean;
}

export interface TournamentEvalEligibleMeta {
  id: string;
  name: string;
  completedAt: string | null;
  buyIn: number;
  position: number;
  prize: number;
  reentries: number;
  handCount: number;
  latestEvaluationAt: string | null;
}

export function useTournamentEvaluations(enabled: boolean) {
  const [quota, setQuota] = useState<TournamentEvalQuota | null>(null);
  const [eligible, setEligible] = useState<TournamentEvalEligibleMeta[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setQuota(null);
      setEligible([]);
      return;
    }
    setLoading(true);
    try {
      const [qRes, eRes] = await Promise.all([
        fetch(`${API_BASE}/api/tournament-evaluations/quota`, { credentials: 'include' }),
        fetch(`${API_BASE}/api/tournament-evaluations/eligible`, { credentials: 'include' }),
      ]);
      if (qRes.ok) setQuota((await qRes.json()) as TournamentEvalQuota);
      else setQuota(null);
      if (eRes.ok) {
        const e = (await eRes.json()) as { tournaments: TournamentEvalEligibleMeta[] };
        setEligible(e.tournaments);
      } else {
        setEligible([]);
      }
    } catch {
      setQuota(null);
      setEligible([]);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  return { quota, eligible, loading, refresh };
}
