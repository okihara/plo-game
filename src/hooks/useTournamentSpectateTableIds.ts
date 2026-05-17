import { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

/**
 * トーナメント観戦URL（?tournament=）用に、サーバー上の卓ID一覧を取得する。
 * メモリにトーナメントが無い場合は空配列。
 * 戻り値の refresh() を呼ぶと即時で再取得し、最新の卓ID配列を返す（自動ジャンプ用）。
 */
export function useTournamentSpectateTableIds(tournamentId: string | undefined) {
  const [tableIds, setTableIds] = useState<string[]>([]);
  const fetchRef = useRef<() => Promise<string[]>>(async () => []);

  useEffect(() => {
    if (!tournamentId?.trim()) {
      setTableIds([]);
      fetchRef.current = async () => [];
      return;
    }

    let cancelled = false;
    const fetchIds = async (): Promise<string[]> => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/${encodeURIComponent(tournamentId)}/tables`);
        if (!res.ok || cancelled) return [];
        const data = (await res.json()) as { tableIds?: string[] };
        const ids = data.tableIds ?? [];
        if (!cancelled) setTableIds(ids);
        return ids;
      } catch {
        if (!cancelled) setTableIds([]);
        return [];
      }
    };
    fetchRef.current = fetchIds;

    fetchIds();
    const interval = setInterval(fetchIds, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      fetchRef.current = async () => [];
    };
  }, [tournamentId]);

  const refresh = useCallback(() => fetchRef.current(), []);

  return { tableIds, refresh };
}
