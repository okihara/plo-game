import { useState, useEffect, useCallback, useRef } from 'react';
import { wsService } from '../services/websocket';

export interface TournamentLobbyInfo {
  id: string;
  name: string;
  status: string;
  buyIn: number;
  startingChips: number;
  registeredPlayers: number;
  maxPlayers: number;
  currentBlindLevel: number;
  prizePool: number;
  scheduledStartTime?: string;
  isLateRegistrationOpen: boolean;
}

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

export interface TournamentState {
  tournamentId: string;
  name: string;
  status: string;
  buyIn: number;
  startingChips: number;
  prizePool: number;
  totalPlayers: number;
  playersRemaining: number;
  currentBlindLevel: BlindLevel;
  nextBlindLevel: BlindLevel | null;
  nextLevelAt: number;
  myChips: number | null;
  myTableId: string | null;
  averageStack: number;
  largestStack: number;
  smallestStack: number;
  payoutStructure: { position: number; amount: number }[];
  isLateRegistrationOpen: boolean;
  isFinalTable: boolean;
}

export interface EliminationInfo {
  position: number;
  totalPlayers: number;
  prizeAmount: number;
}

export interface TournamentResult {
  odId: string;
  odName: string;
  position: number;
  prize: number;
  reentries: number;
}

export interface TournamentCompletedData {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
}

export interface PlayerEliminatedData {
  odId: string;
  odName: string;
  position: number;
  playersRemaining: number;
}

export function useTournamentState() {
  const [tournaments, setTournaments] = useState<TournamentLobbyInfo[]>([]);
  const [tournamentState, setTournamentState] = useState<TournamentState | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registeredTournamentId, setRegisteredTournamentId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // UI overlay states
  const [elimination, setElimination] = useState<EliminationInfo | null>(null);
  const [completedData, setCompletedData] = useState<TournamentCompletedData | null>(null);
  const [isChangingTable, setIsChangingTable] = useState(false);
  const [isFinalTable, setIsFinalTable] = useState(false);
  const [lastEliminated, setLastEliminated] = useState<PlayerEliminatedData | null>(null);
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
    wsService.setListeners({
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
