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

export function useTournamentState() {
  const [tournaments, setTournaments] = useState<TournamentLobbyInfo[]>([]);
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
  const [error, setError] = useState<string | null>(null);

  const eliminatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const refreshList = useCallback(() => {
    wsService.listTournaments();
  }, []);

  const register = useCallback((tournamentId: string) => {
    wsService.registerTournament(tournamentId);
  }, []);

  const unregister = useCallback((tournamentId: string) => {
    wsService.unregisterTournament(tournamentId);
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

      onTournamentList: (data) => {
        setTournaments(data.tournaments);
      },

      onTournamentRegistered: (data) => {
        setIsRegistered(true);
        setRegisteredTournamentId(data.tournamentId);
        setError(null);
        // リスト更新
        wsService.listTournaments();
      },

      onTournamentUnregistered: () => {
        setIsRegistered(false);
        setRegisteredTournamentId(null);
        setTournamentState(null);
        wsService.listTournaments();
      },

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

      onTournamentBlindChange: (_data) => {
        // tournamentState の更新で反映される
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
  }, []);

  return {
    // Connection
    isConnected,
    isConnecting,
    connect,
    disconnect,

    // Tournament list
    tournaments,
    refreshList,

    // Registration
    isRegistered,
    registeredTournamentId,
    register,
    unregister,
    reenter,

    // Tournament state
    tournamentState,

    // UI overlays
    elimination,
    completedData,
    isChangingTable,
    isFinalTable,
    lastEliminated,
    error,

    // Actions
    clearElimination,
    clearCompleted,
  };
}
