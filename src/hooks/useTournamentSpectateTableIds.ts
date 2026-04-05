import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

/**
 * トーナメント観戦URL（?tournament=）用に、サーバー上の卓ID一覧を取得する。
 * メモリにトーナメントが無い場合は空配列。
 */
export function useTournamentSpectateTableIds(tournamentId: string | undefined) {
  const [tableIds, setTableIds] = useState<string[]>([]);

  useEffect(() => {
    if (!tournamentId?.trim()) {
      setTableIds([]);
      return;
    }

    let cancelled = false;
    const fetchIds = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/${encodeURIComponent(tournamentId)}/tables`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { tableIds?: string[] };
        if (!cancelled) setTableIds(data.tableIds ?? []);
      } catch {
        if (!cancelled) setTableIds([]);
      }
    };

    fetchIds();
    const interval = setInterval(fetchIds, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tournamentId]);

  return tableIds;
}
