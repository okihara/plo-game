import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import type { ClientGameState } from '../../server/src/shared/types/websocket';
import type { Card, Action, GameState, Player, Position } from '../logic/types';
import type { LastAction, ActionTimeoutAt } from './useOnlineGameState';

// ============================================
// 定数
// ============================================

const ACTION_MARKER_DISPLAY_TIME = 1000;
const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

// ============================================
// ヘルパー関数
// ============================================

function convertOnlinePlayerToPlayer(
  online: import('../../server/src/shared/types/websocket').OnlinePlayer | null,
  index: number,
  dealerSeat: number
): Player {
  if (!online) {
    return {
      id: index,
      name: `Seat ${index + 1}`,
      chips: 0,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      folded: true,
      isAllIn: false,
      hasActed: true,
      isSittingOut: true,
      position: POSITIONS[(index - dealerSeat + 6) % 6],
    };
  }

  const posIndex = (index - dealerSeat + 6) % 6;

  return {
    id: index,
    name: online.odName,
    chips: online.chips,
    holeCards: [],
    currentBet: online.currentBet,
    totalBetThisRound: online.currentBet,
    folded: online.folded,
    isAllIn: online.isAllIn,
    hasActed: online.hasActed,
    isSittingOut: false,
    position: POSITIONS[posIndex],
    avatarId: online.avatarId,
    avatarUrl: online.avatarUrl,
    odId: online.odId,
  };
}

function convertToSpectatorGameState(
  clientState: ClientGameState,
  allHoleCards: Map<number, Card[]>
): GameState {
  const players = clientState.players.map((p, i) =>
    convertOnlinePlayerToPlayer(p, i, clientState.dealerSeat)
  );

  // 全員のホールカードをセット
  allHoleCards.forEach((cards, seatIndex) => {
    if (players[seatIndex]) {
      players[seatIndex].holeCards = cards;
    }
  });

  return {
    players,
    deck: [],
    communityCards: clientState.communityCards,
    pot: clientState.pot,
    sidePots: (clientState.sidePots || []).map(sp => ({
      amount: sp.amount,
      eligiblePlayers: sp.eligiblePlayerSeats,
    })),
    currentStreet: clientState.currentStreet as 'preflop' | 'flop' | 'turn' | 'river',
    currentBet: clientState.currentBet,
    minRaise: clientState.minRaise,
    dealerPosition: clientState.dealerSeat,
    smallBlind: clientState.smallBlind,
    bigBlind: clientState.bigBlind,
    currentPlayerIndex: clientState.currentPlayerSeat ?? 0,
    lastRaiserIndex: -1,
    handHistory: [],
    isHandComplete: !clientState.isHandInProgress,
    winners: [],
    rake: 0,
  };
}

// ============================================
// メインフック
// ============================================

export function useSpectatorState(tableId: string) {
  // 接続状態
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // ゲーム状態
  const [clientState, setClientState] = useState<ClientGameState | null>(null);
  const [allHoleCards, setAllHoleCards] = useState<Map<number, Card[]>>(new Map());

  // UI状態
  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [isDealingCards, setIsDealingCards] = useState(false);
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);
  const [actionTimeoutAt, setActionTimeoutAt] = useState<ActionTimeoutAt | null>(null);
  const [actionTimeoutMs, setActionTimeoutMs] = useState<number | null>(null);
  const [winners, setWinners] = useState<{ playerId: number; amount: number; handName: string }[]>([]);

  // Refs
  const actionMarkerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const dealingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientStateRef = useRef<ClientGameState | null>(null);

  // ============================================
  // アクションマーカー管理
  // ============================================

  const clearAllActionMarkerTimers = useCallback(() => {
    actionMarkerTimersRef.current.forEach(timer => clearTimeout(timer));
    actionMarkerTimersRef.current.clear();
  }, []);

  const scheduleActionMarkerClear = useCallback((playerId: number) => {
    const existingTimer = actionMarkerTimersRef.current.get(playerId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      setLastActions(prev => {
        const newMap = new Map(prev);
        newMap.delete(playerId);
        return newMap;
      });
      actionMarkerTimersRef.current.delete(playerId);
    }, ACTION_MARKER_DISPLAY_TIME);

    actionMarkerTimersRef.current.set(playerId, timer);
  }, []);

  const recordAction = useCallback((playerId: number, action: Action, amount: number) => {
    setLastActions(prev => {
      const newMap = new Map(prev);
      newMap.set(playerId, { action, amount, timestamp: Date.now() });
      return newMap;
    });
    scheduleActionMarkerClear(playerId);
  }, [scheduleActionMarkerClear]);

  const startDealingAnimation = useCallback(() => {
    if (dealingTimerRef.current) {
      clearTimeout(dealingTimerRef.current);
    }
    setIsDealingCards(true);
    dealingTimerRef.current = setTimeout(() => {
      setIsDealingCards(false);
      dealingTimerRef.current = null;
    }, 1000);
  }, []);

  // ============================================
  // WebSocket接続
  // ============================================

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectionError(null);

    try {
      await wsService.connect();
      setIsConnected(true);
      wsService.spectateTable(tableId);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  }, [tableId]);

  const disconnect = useCallback(() => {
    wsService.disconnect();
    setIsConnected(false);
    setClientState(null);
    setAllHoleCards(new Map());
  }, []);

  // ============================================
  // イベントリスナー設定
  // ============================================

  // clientStateRef を常に最新に同期（イベントハンドラ内での stale closure を防ぐ）
  useEffect(() => {
    clientStateRef.current = clientState;
  }, [clientState]);

  useEffect(() => {
    wsService.setListeners({
      onConnected: () => {
        setIsConnected(true);
      },
      onDisconnected: () => {
        setIsConnected(false);
      },
      onError: (message) => {
        setConnectionError(message);
      },
      onGameState: (state) => {
        // ストリート変更検出
        if (prevStreetRef.current && state.currentStreet !== prevStreetRef.current) {
          setNewCommunityCardsCount(state.communityCards.length - prevCardCountRef.current);
        } else {
          setNewCommunityCardsCount(0);
        }

        prevStreetRef.current = state.currentStreet;
        prevCardCountRef.current = state.communityCards.length;
        setClientState(state);
        setActionTimeoutAt(state.actionTimeoutAt ?? null);
        setActionTimeoutMs(state.actionTimeoutMs ?? null);
      },
      onAllHoleCards: (players) => {
        const map = new Map<number, Card[]>();
        players.forEach(p => map.set(p.seatIndex, p.cards));
        setAllHoleCards(map);
        startDealingAnimation();
        prevStreetRef.current = null;
        prevCardCountRef.current = 0;
        setWinners([]);
      },
      onActionTaken: ({ playerId, action, amount }) => {
        // refで最新のclientStateを参照
        const currentState = clientStateRef.current;
        const seat = currentState?.players.findIndex(p => p?.odId === playerId);
        if (seat !== undefined && seat >= 0) {
          recordAction(seat, action, amount);
        }
      },
      onHandComplete: (serverWinners, _rake) => {
        // refで最新のclientStateを参照
        const currentState = clientStateRef.current;
        if (currentState) {
          const convertedWinners = serverWinners.map(w => {
            const seat = currentState.players.findIndex(p => p?.odId === w.playerId);
            return {
              playerId: seat >= 0 ? seat : 0,
              amount: w.amount,
              handName: w.handName,
            };
          });
          setWinners(convertedWinners);
        }
      },
    });

    return () => {
      clearAllActionMarkerTimers();
      if (dealingTimerRef.current) {
        clearTimeout(dealingTimerRef.current);
        dealingTimerRef.current = null;
      }
    };
  }, [clearAllActionMarkerTimers, recordAction, startDealingAnimation]);

  // ============================================
  // 変換されたGameState
  // ============================================

  const baseGameState = clientState
    ? convertToSpectatorGameState(clientState, allHoleCards)
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
    gameState,
    lastActions,
    isDealingCards,
    newCommunityCardsCount,
    actionTimeoutAt,
    actionTimeoutMs,
    connect,
    disconnect,
  };
}
