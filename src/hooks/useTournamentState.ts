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
  const [isRegistered, setIsRegistered] = useState(false);
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
    setIsRegistered(false);
    setRegisteredTournamentId(null);
  }, []);

  const refreshList = useCallback(async () => {
    const isFirst = !initialListFetchedRef.current;
    if (isFirst) setIsListLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/tournaments`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tournaments?: TournamentLobbyInfo[] };
      setTournaments(data.tournaments ?? []);
    } catch {
      if (isFirst) setTournaments([]);
    } finally {
      if (isFirst) {
        setIsListLoading(false);
        initialListFetchedRef.current = true;
      }
    }
  }, []);

  const register = useCallback((tournamentId: string) => {
    wsService.registerTournament(tournamentId);
  }, []);

  const reenter = useCallback((tournamentId: string) => {
    wsService.reenterTournament(tournamentId);
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

      onTournamentRegistered: (data) => {
        setIsRegistered(true);
        setRegisteredTournamentId(data.tournamentId);
        setError(null);
        void refreshList();
      },

      onTournamentState: (state) => {
        setTournamentState(state);
        // 再接続時: tournament:state が来た = このトーナメントに登録済み
        if (state.tournamentId) {
          setIsRegistered(true);
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
      },

      onTournamentFinalTable: () => {
        setIsFinalTable(true);
      },

      onTournamentCompleted: (data) => {
        setCompletedData(data);
      },

      onTournamentError: (data) => {
        setError(data.message);
        setTimeout(() => setError(null), 5000);
      },

      onTournamentCancelled: () => {
        setTournamentState(null);
        setIsRegistered(false);
        setRegisteredTournamentId(null);
        setError('トーナメントがキャンセルされました');
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
    isRegistered,
    registeredTournamentId,
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

    // Actions
    clearElimination,
    clearCompleted,
  };
}
