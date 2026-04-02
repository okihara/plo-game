import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import { playActionSound } from '../services/actionSound';
import type { ClientGameState } from '@plo/shared';
import type { Action, Card, GameState } from '../logic/types';
import { convertClientStateToGameState } from './onlineGameShared';
import type { LastAction, ActionTimeoutAt } from './useOnlineGameState';

export interface SpectatorGameHookResult {
  isConnecting: boolean;
  isConnected: boolean;
  connectionError: string | null;
  isDisplaced: boolean;
  gameState: GameState | null;
  tableId: string | null;
  myHoleCards: Card[];
  lastActions: Map<number, LastAction>;
  isDealingCards: boolean;
  newCommunityCardsCount: number;
  actionTimeoutAt: ActionTimeoutAt | null;
  actionTimeoutMs: number | null;
  showdownHandNames: Map<number, string>;
  maintenanceStatus: { isActive: boolean; message: string } | null;
  announcementStatus: { isActive: boolean; message: string } | null;
  connectAndWatch: () => Promise<void>;
  disconnect: () => void;
}

/**
 * 観戦モード（table:spectate_join）。接続は connectionMode: spectate のみ。
 */
export function useSpectatorGameState(watchTableId: string, inviteCode?: string): SpectatorGameHookResult {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isDisplaced, setIsDisplaced] = useState(false);

  const [clientState, setClientState] = useState<ClientGameState | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [myHoleCards] = useState<Card[]>([]);
  const mySeat = null;

  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);
  const [actionTimeoutAt, setActionTimeoutAt] = useState<ActionTimeoutAt | null>(null);
  const [actionTimeoutMs, setActionTimeoutMs] = useState<number | null>(null);
  const [winners, setWinners] = useState<{ playerId: number; amount: number; handName: string }[]>([]);
  const [showdownCards, setShowdownCards] = useState<Map<number, Card[]>>(new Map());
  const [showdownHandNames, setShowdownHandNames] = useState<Map<number, string>>(new Map());
  const [maintenanceStatus, setMaintenanceStatus] = useState<{ isActive: boolean; message: string } | null>(null);
  const [announcementStatus, setAnnouncementStatus] = useState<{ isActive: boolean; message: string } | null>(null);

  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const clientStateRef = useRef<ClientGameState | null>(null);
  const pendingShowdownHandNamesRef = useRef<Map<number, string> | null>(null);
  /** 観戦は game:hole_cards が来ないため、新ハンドは isHandInProgress の false→true で演出をクリア */
  const prevIsHandInProgressRef = useRef(false);

  const clearAllActionMarkers = useCallback(() => {
    setLastActions(new Map());
  }, []);

  const recordAction = useCallback(
    (
      playerId: number,
      action: Action,
      amount: number,
      drawCount?: number,
      displayChipTotal?: number
    ) => {
      setLastActions(prev => {
        const newMap = new Map(prev);
        newMap.set(playerId, { action, amount, timestamp: Date.now(), drawCount, displayChipTotal });
        return newMap;
      });
    },
    []
  );

  useEffect(() => {
    clientStateRef.current = clientState;
  }, [clientState]);

  const connectAndWatch = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);
    try {
      await wsService.connect({ connectionMode: 'spectate' });
      setIsConnected(true);
      wsService.joinSpectate(watchTableId, inviteCode);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  }, [watchTableId, inviteCode]);

  const disconnect = useCallback(() => {
    wsService.leaveSpectate();
    wsService.disconnect();
    setIsConnected(false);
    setTableId(null);
    setClientState(null);
    setWinners([]);
    setShowdownCards(new Map());
    setShowdownHandNames(new Map());
    pendingShowdownHandNamesRef.current = null;
    prevIsHandInProgressRef.current = false;
  }, []);

  useEffect(() => {
    wsService.addListeners('spectator', {
      onConnected: () => {
        setIsConnected(true);
        setConnectionError(null);
      },
      onDisconnected: (message) => {
        setIsConnected(false);
        setConnectionError(message);
      },
      onError: (message) => {
        setConnectionError(message);
      },
      onSpectateJoined: (tid) => {
        setTableId(tid);
        prevIsHandInProgressRef.current = false;
      },
      onSpectateLeft: () => {
        setTableId(null);
        setClientState(null);
        setWinners([]);
        setShowdownCards(new Map());
        setShowdownHandNames(new Map());
        pendingShowdownHandNamesRef.current = null;
        prevIsHandInProgressRef.current = false;
      },
      onGameState: (state) => {
        const nowInProgress = state.isHandInProgress;
        const wasInProgress = prevIsHandInProgressRef.current;
        prevIsHandInProgressRef.current = nowInProgress;
        if (!wasInProgress && nowInProgress) {
          setWinners([]);
          setShowdownCards(new Map());
          setShowdownHandNames(new Map());
          pendingShowdownHandNamesRef.current = null;
        }

        if (prevStreetRef.current && state.currentStreet !== prevStreetRef.current) {
          setNewCommunityCardsCount(state.communityCards.length - prevCardCountRef.current);
          clearAllActionMarkers();
        } else {
          setNewCommunityCardsCount(0);
        }
        if (state.currentPlayerSeat !== null) {
          setLastActions(prev => {
            if (prev.has(state.currentPlayerSeat!)) {
              const newMap = new Map(prev);
              newMap.delete(state.currentPlayerSeat!);
              return newMap;
            }
            return prev;
          });
        }
        prevStreetRef.current = state.currentStreet;
        prevCardCountRef.current = state.communityCards.length;
        setClientState(state);
        setActionTimeoutAt(state.actionTimeoutAt ?? null);
        setActionTimeoutMs(state.actionTimeoutMs ?? null);
      },
      onHoleCards: () => {
        /* 観戦者には配られない想定。万一届いても無視 */
      },
      onActionTaken: ({ playerId, action, amount, drawCount }) => {
        playActionSound(action);
        setActionTimeoutAt(null);
        setClientState(prev => (prev ? { ...prev, currentPlayerSeat: null } : prev));
        const currentState = clientStateRef.current;
        if (!currentState) return;
        const seat = currentState.players.findIndex(p => p?.odId === playerId);
        if (seat < 0) return;
        const acting = currentState.players[seat];
        if (!acting) return;
        const prevBet = acting.currentBet;
        const chipMoving = action === 'bet' || action === 'raise' || action === 'call' || action === 'allin';
        const displayChipTotal = chipMoving ? prevBet + amount : undefined;
        recordAction(seat, action, amount, drawCount, displayChipTotal);
      },
      onHandComplete: serverWinners => {
        const currentState = clientStateRef.current;
        if (currentState) {
          const convertedWinners = serverWinners.map(w => {
            const seat = currentState.players.findIndex(p => p?.odId === w.playerId);
            return {
              playerId: seat,
              amount: w.amount,
              handName: w.handName,
            };
          });
          setWinners(convertedWinners);
          if (pendingShowdownHandNamesRef.current) {
            setShowdownHandNames(pendingShowdownHandNamesRef.current);
          }
        }
      },
      onShowdown: ({ players: showdownPlayers }) => {
        const cardsMap = new Map<number, Card[]>();
        const handNamesMap = new Map<number, string>();
        for (const p of showdownPlayers) {
          cardsMap.set(p.seatIndex, p.cards);
          if (p.handName) handNamesMap.set(p.seatIndex, p.handName);
        }
        setShowdownCards(cardsMap);
        pendingShowdownHandNamesRef.current = handNamesMap;
      },
      onMaintenanceStatus: data => setMaintenanceStatus(data),
      onAnnouncementStatus: data => setAnnouncementStatus(data),
      onDisplaced: () => {
        setIsDisplaced(true);
        setIsConnected(false);
      },
    });

    return () => {
      wsService.removeListeners('spectator');
      clearAllActionMarkers();
    };
  }, [clearAllActionMarkers, recordAction]);

  const baseGameState = clientState
    ? convertClientStateToGameState(clientState, myHoleCards, mySeat, showdownCards)
    : null;

  const gameState = baseGameState
    ? {
        ...baseGameState,
        winners,
        isHandComplete: baseGameState.isHandComplete || winners.length > 0,
      }
    : null;

  return {
    isConnecting,
    isConnected,
    connectionError,
    isDisplaced,
    gameState,
    tableId,
    myHoleCards,
    lastActions,
    isDealingCards: false,
    newCommunityCardsCount,
    actionTimeoutAt,
    actionTimeoutMs,
    showdownHandNames,
    maintenanceStatus,
    announcementStatus,
    connectAndWatch,
    disconnect,
  };
}
