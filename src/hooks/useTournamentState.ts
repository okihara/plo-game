import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/websocket';
import type {
  TournamentLobbyInfo,
  ClientTournamentState,
  TournamentEliminationInfo,
  TournamentCompletedData,
  TournamentPlayerEliminatedData,
} from '@plo/shared';

// Re-export shared types for components that import from this hook
export type { TournamentLobbyInfo, ClientTournamentState, TournamentCompletedData, TournamentPlayerEliminatedData } from '@plo/shared';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

export function useTournamentState() {
  const [tournaments, setTournaments] = useState<TournamentLobbyInfo[]>([]);
  const [isListLoading, setIsListLoading] = useState(true);
  const initialListFetchedRef = useRef(false);
  const [tournamentState, setTournamentState] = useState<ClientTournamentState | null>(null);
  const [registeredTournamentId, setRegisteredTournamentId] = useState<string | null>(null);
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
    setRegisteredTournamentId(null);
  }, []);

  const refreshList = useCallback(async () => {
    const isFirst = !initialListFetchedRef.current;
    if (isFirst) setIsListLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tournaments`, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        tournaments?: TournamentLobbyInfo[];
        myTournamentId?: string | null;
        canReenterTournamentId?: string | null;
        myEliminatedTournamentId?: string | null;
        myFinishedTournamentIds?: string[];
      };
      setTournaments(data.tournaments ?? []);
      // DB参加記録に基づいて参加状態を更新
      setRegisteredTournamentId(data.myTournamentId ?? null);
      setCanReenterTournamentId(data.canReenterTournamentId ?? null);
      setMyEliminatedTournamentId(data.myEliminatedTournamentId ?? null);
      setMyFinishedTournamentIds(new Set(data.myFinishedTournamentIds ?? []));
    } catch {
      if (isFirst) setTournaments([]);
    } finally {
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
      setRegisteredTournamentId(tournamentId);
      return { success: true };
    } catch {
      return { success: false, error: '通信エラーが発生しました' };
    }
  }, []);

  const [canReenterTournamentId, setCanReenterTournamentId] = useState<string | null>(null);
  const [myEliminatedTournamentId, setMyEliminatedTournamentId] = useState<string | null>(null);
  const [myFinishedTournamentIds, setMyFinishedTournamentIds] = useState<Set<string>>(new Set());

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
      setCanReenterTournamentId(null);
      setRegisteredTournamentId(tournamentId);
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
        // 再接続時: tournament:state が来た = このトーナメントに参加中
        if (state.tournamentId) {
          setRegisteredTournamentId(state.tournamentId);
        }
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
        const msg = `ブラインドアップ\n${data.level.smallBlind} / ${data.level.bigBlind}\n次のハンドから適用`;
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
        setRegisteredTournamentId(null);
      },

      onTournamentFinalTable: () => {
        setIsFinalTable(true);
      },

      onTournamentCompleted: (data) => {
        setCompletedData(data);
        setRegisteredTournamentId(null);
      },

      onTournamentError: (data) => {
        setError(data.message);
        setTimeout(() => setError(null), 5000);
      },

      onTournamentCancelled: () => {
        setTournamentState(null);
        setRegisteredTournamentId(null);
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

    // Registration
    registeredTournamentId,
    canReenterTournamentId,
    myEliminatedTournamentId,
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
