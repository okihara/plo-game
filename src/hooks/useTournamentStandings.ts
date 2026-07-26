import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentStandings } from '@plo/shared';
import { wsService } from '../services/websocket';

/** サーバーが応答しない場合に諦めるまでの時間 (ms) */
const REQUEST_TIMEOUT_MS = 8000;
/** イベント起点の再取得を取りこぼしたときの保険 (ms) */
const FALLBACK_REFRESH_MS = 10_000;
/**
 * イベント起点の再取得を束ねる待ち時間 (ms)。
 * 1回のバストで tournament:player_eliminated と tournament:state が続けて飛ぶ
 * （残り2人になるときは state がもう1回飛ぶ）ため、素直に投げると同じ内容を
 * 2〜3回取りに行くことになる。体感できない範囲で待って1回にまとめる。
 */
const COALESCE_MS = 300;

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
  const coalesceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  /** 即座に投げる。初回取得と手動リトライ用。 */
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

  /** 短時間に連続するイベントを1回の要求に束ねる。 */
  const scheduleRequest = useCallback(() => {
    if (coalesceRef.current) return;
    coalesceRef.current = setTimeout(() => {
      coalesceRef.current = null;
      request();
    }, COALESCE_MS);
  }, [request]);

  const clearPendingCoalesce = useCallback(() => {
    if (coalesceRef.current) {
      clearTimeout(coalesceRef.current);
      coalesceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !tournamentId) {
      clearPendingTimeout();
      clearPendingCoalesce();
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
      // 残り人数やチップが動いたであろうタイミングで追随する。
      // 同じバストで両方が飛ぶので、束ねてから1回だけ取りに行く。
      onTournamentState: () => scheduleRequest(),
      onTournamentPlayerEliminated: () => scheduleRequest(),
    });

    request();
    const fallback = setInterval(request, FALLBACK_REFRESH_MS);

    return () => {
      clearInterval(fallback);
      clearPendingTimeout();
      clearPendingCoalesce();
      wsService.removeListeners('tournament-standings');
    };
  }, [enabled, tournamentId, request, scheduleRequest, clearPendingTimeout, clearPendingCoalesce]);

  return { standings, loading, error, refetch: request };
}
