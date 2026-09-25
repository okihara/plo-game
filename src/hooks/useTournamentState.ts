import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/websocket';
import type {
  TournamentLobbyInfo,
  ClientTournamentState,
  TournamentEliminationInfo,
  TournamentCompletedData,
  TournamentPlayerEliminatedData,
  FinishedTournamentsWindow,
  MyTournamentEntry,
  TournamentEntryStatus,
} from '@plo/shared';

// Re-export shared types for components that import from this hook
export type { TournamentLobbyInfo, ClientTournamentState, TournamentCompletedData, TournamentPlayerEliminatedData, FinishedTournamentsWindow, TournamentEntryStatus } from '@plo/shared';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export function useTournamentState() {
  const [tournaments, setTournaments] = useState<TournamentLobbyInfo[]>([]);
  const [isListLoading, setIsListLoading] = useState(true);
  const [finishedWindow, setFinishedWindow] = useState<FinishedTournamentsWindow | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const weekOffsetRef = useRef(0);
  const initialListFetchedRef = useRef(false);
  const listRequestSeqRef = useRef(0);
  const [tournamentState, setTournamentState] = useState<ClientTournamentState | null>(null);
  // 進行中トーナメントへの自分の参加状態。サーバー（一覧API）の判定だけを反映し、クライアントでは書き換えない
  const [myEntryStatuses, setMyEntryStatuses] = useState<ReadonlyMap<string, TournamentEntryStatus>>(new Map());
  const [myFinishedTournamentIds, setMyFinishedTournamentIds] = useState<Set<string>>(new Set());
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // UI overlay states
  const [elimination, setElimination] = useState<TournamentEliminationInfo | null>(null);
  const [completedData, setCompletedData] = useState<TournamentCompletedData | null>(null);
  const [isChangingTable, setIsChangingTable] = useState(false);
  const [isFinalTable, setIsFinalTable] = useState(false);
  const [lastEliminated, setLastEliminated] = useState<TournamentPlayerEliminatedData | null>(null);
  const [blindChangeNotice, setBlindChangeNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<{ isActive: boolean; message: string } | null>(null);
  const [announcementStatus, setAnnouncementStatus] = useState<{ isActive: boolean; message: string } | null>(null);

  const eliminatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blindNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    if (wsService.isConnected()) {
      setIsConnected(true);
      return;
    }
    setIsConnecting(true);
    try {
      await wsService.connect();
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    wsService.disconnect();
    setIsConnected(false);
    setTournamentState(null);
  }, []);

  const refreshList = useCallback(async (nextWeekOffset?: number) => {
    const offset = nextWeekOffset ?? weekOffsetRef.current;
    const requestSeq = ++listRequestSeqRef.current;
    const isFirst = !initialListFetchedRef.current;
    if (isFirst) setIsListLoading(true);
    try {
      const url = `${API_BASE}/api/tournaments?weekOffset=${offset}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (requestSeq !== listRequestSeqRef.current) return;
      const data = (await res.json()) as {
        tournaments?: TournamentLobbyInfo[];
        myEntries?: MyTournamentEntry[];
        myFinishedTournamentIds?: string[];
        finishedWindow?: FinishedTournamentsWindow;
      };
      setTournaments(data.tournaments ?? []);
      setFinishedWindow(data.finishedWindow ?? null);
      if (nextWeekOffset !== undefined) {
        weekOffsetRef.current = offset;
        setWeekOffset(offset);
      }
      setMyEntryStatuses(new Map((data.myEntries ?? []).map((e) => [e.tournamentId, e.status])));
      setMyFinishedTournamentIds(new Set(data.myFinishedTournamentIds ?? []));
    } catch {
      if (requestSeq !== listRequestSeqRef.current) return;
      if (isFirst) setTournaments([]);
    } finally {
      if (requestSeq !== listRequestSeqRef.current) return;
      if (isFirst) {
        setIsListLoading(false);
        initialListFetchedRef.current = true;
      }
    }
  }, []);

  const register = useCallback(async (tournamentId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}/register`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as { success?: boolean; error?: string; tournamentId?: string };
      if (!res.ok || !data.success) {
        return { success: false, error: data.error ?? '登録に失敗しました' };
      }
      // 参加状態はサーバーの判定を取り直して反映する
      await refreshList();
      return { success: true };
    } catch {
      return { success: false, error: '通信エラーが発生しました' };
    }
  }, [refreshList]);

  const reenter = useCallback(async (tournamentId: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}/reenter`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        return { success: false, error: data.error ?? 'リエントリーに失敗しました' };
      }
      return { success: true };
    } catch {
      return { success: false, error: '通信エラーが発生しました' };
    }
  }, []);

  const clearElimination = useCallback(() => {
    setElimination(null);
  }, []);

  const clearCompleted = useCallback(() => {
    setCompletedData(null);
  }, []);

  useEffect(() => {
    wsService.addListeners('tournament', {
      onConnected: () => setIsConnected(true),
      onDisconnected: () => setIsConnected(false),

      onTournamentState: (state) => {
        setTournamentState(state);
      },

      onTournamentTableAssigned: (_data) => {
        setIsChangingTable(false);
      },

      onTournamentTableMove: () => {
        setIsChangingTable(true);
        // テーブル移動演出（1.5秒後にリセット）
        setTimeout(() => setIsChangingTable(false), 1500);
      },

      onTournamentBlindChange: (data) => {
        // テーブル中央に通知
        const msg = `ブラインドアップ\n${data.level.smallBlind} / ${data.level.bigBlind}${data.level.ante >= 1 ? ` (ante ${data.level.ante})` : ''}\n次のハンドから適用`;
        if (blindNoticeTimerRef.current) clearTimeout(blindNoticeTimerRef.current);
        setBlindChangeNotice(msg);
        blindNoticeTimerRef.current = setTimeout(() => setBlindChangeNotice(null), 5000);
      },

      onTournamentPlayerEliminated: (data) => {
        setLastEliminated(data);
        // 5秒後にクリア
        if (eliminatedTimerRef.current) clearTimeout(eliminatedTimerRef.current);
        eliminatedTimerRef.current = setTimeout(() => setLastEliminated(null), 5000);
      },

      onTournamentEliminated: (data) => {
        setElimination(data);
        void refreshList();
      },

      onTournamentFinalTable: () => {
        setIsFinalTable(true);
      },

      onTournamentCompleted: (data) => {
        setCompletedData(data);
        void refreshList();
      },

      onTournamentError: (data) => {
        setError(data.message);
        setTimeout(() => setError(null), 5000);
      },

      onTournamentCancelled: () => {
        setTournamentState(null);
        void refreshList();
        setError('トーナメントがキャンセルされました');
      },

      onMaintenanceStatus: (data) => {
        setMaintenanceStatus(data);
      },
      onAnnouncementStatus: (data) => {
        setAnnouncementStatus(data);
      },
    });

    return () => {
      wsService.removeListeners('tournament');
      if (eliminatedTimerRef.current) clearTimeout(eliminatedTimerRef.current);
    };
  }, [refreshList]);

  return {
    // Connection
    isConnected,
    isConnecting,
    connect,
    disconnect,

    // Tournament list
    tournaments,
    refreshList,
    isListLoading,
    finishedWindow,
    weekOffset,

    // Registration
    myEntryStatuses,
    myFinishedTournamentIds,
    register,
    reenter,

    // Tournament state
    tournamentState,

    // UI overlays
    elimination,
    completedData,
    isChangingTable,
    isFinalTable,
    lastEliminated,
    blindChangeNotice,
    error,
    maintenanceStatus,
    announcementStatus,

    // Actions
    clearElimination,
    clearCompleted,
  };
}
