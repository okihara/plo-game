import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentStandings } from '@plo/shared';
import { wsService } from '../services/websocket';

/** サーバーが応答しない場合に諦めるまでの時間 (ms) */
const REQUEST_TIMEOUT_MS = 8000;
/** イベント起点の再取得を取りこぼしたときの保険 (ms) */
const FALLBACK_REFRESH_MS = 10_000;

/**
 * チップスタンディングをオンデマンドで取得する。
 *
 * サーバーの `broadcastTournamentState()` はチップ変動では飛ばないため、
 * スタンディングは `ClientTournamentState` に同梱されていない。
 * `enabled`（＝クロックパネルが開いている間）だけ `tournament:request_standings`
 * を投げ、トーナメント状態の更新・敗退通知をトリガーに追随する。
 */
export function useTournamentStandings(tournamentId: string | null, enabled: boolean) {
  const [standings, setStandings] = useState<TournamentStandings | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // リスナー内から最新値を読むための ref（リスナーの再登録を避ける）
  const tournamentIdRef = useRef(tournamentId);
  tournamentIdRef.current = tournamentId;
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const request = useCallback(() => {
    const id = tournamentIdRef.current;
    if (!id) return;
    setLoading(true);
    setError(false);
    clearPendingTimeout();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setLoading(false);
      setError(true);
    }, REQUEST_TIMEOUT_MS);
    wsService.requestTournamentStandings(id);
  }, [clearPendingTimeout]);

  useEffect(() => {
    if (!enabled || !tournamentId) {
      clearPendingTimeout();
      setLoading(false);
      return;
    }

    // useTournamentState が使う 'tournament' キーとは別キーで登録する。
    // wsService.emit は全サブスクライバーに配るので共存できる。
    wsService.addListeners('tournament-standings', {
      onTournamentStandings: data => {
        if (data.tournamentId !== tournamentIdRef.current) return;
        clearPendingTimeout();
        setStandings(data);
        setLoading(false);
        setError(false);
      },
      // 残り人数やチップが動いたであろうタイミングで追随する
      onTournamentState: () => request(),
      onTournamentPlayerEliminated: () => request(),
    });

    request();
    const fallback = setInterval(request, FALLBACK_REFRESH_MS);

    return () => {
      clearInterval(fallback);
      clearPendingTimeout();
      wsService.removeListeners('tournament-standings');
    };
  }, [enabled, tournamentId, request, clearPendingTimeout]);

  return { standings, loading, error, refetch: request };
}
