import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import type { ClientGameState } from '@plo/shared';
import type { Card, Action, GameState, Player, Position, Street, GameVariant } from '../logic/types';
import type { LastAction, ActionTimeoutAt } from './useOnlineGameState';

// ============================================
// 定数
// ============================================

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
    holeCards: online.cards ?? [],
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
    currentStreet: clientState.currentStreet as Street,
    currentBet: clientState.currentBet,
    minRaise: clientState.minRaise,
    dealerPosition: clientState.dealerSeat,
    smallBlind: clientState.smallBlind,
    bigBlind: clientState.bigBlind,
    currentPlayerIndex: clientState.currentPlayerSeat ?? 0,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: !clientState.isHandInProgress,
    winners: [],
    rake: clientState.rake ?? 0,
    variant: (clientState.variant as GameVariant) ?? 'plo',
    ante: clientState.ante ?? 0,
    bringIn: clientState.bringIn ?? 0,
    betCount: 0,
    maxBetsPerRound: 4,
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
  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const dealingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientStateRef = useRef<ClientGameState | null>(null);

  // ============================================
  // アクションマーカー管理
  // ============================================

  const clearAllActionMarkers = useCallback(() => {
    setLastActions(new Map());
  }, []);

  const recordAction = useCallback((playerId: number, action: Action, amount: number, drawCount?: number) => {
    setLastActions(prev => {
      const newMap = new Map(prev);
      newMap.set(playerId, { action, amount, timestamp: Date.now(), drawCount });
      return newMap;
    });
  }, []);

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
          clearAllActionMarkers();
        } else {
          setNewCommunityCardsCount(0);
        }

        // 手番プレイヤーのマーカーをクリア（同ストリート内で再び手番が回った場合）
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
      onAllHoleCards: (players) => {
        const map = new Map<number, Card[]>();
        players.forEach(p => map.set(p.seatIndex, p.cards));
        setAllHoleCards(map);
        startDealingAnimation();
        prevStreetRef.current = null;
        prevCardCountRef.current = 0;
        setWinners([]);
      },
      onActionTaken: ({ playerId, action, amount, drawCount }) => {
        // refで最新のclientStateを参照
        const currentState = clientStateRef.current;
        const seat = currentState?.players.findIndex(p => p?.odId === playerId);
        if (seat !== undefined && seat >= 0) {
          recordAction(seat, action, amount, drawCount);
        }
      },
      onHandComplete: (serverWinners) => {
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
      clearAllActionMarkers();
      if (dealingTimerRef.current) {
        clearTimeout(dealingTimerRef.current);
        dealingTimerRef.current = null;
      }
    };
  }, [clearAllActionMarkers, recordAction, startDealingAnimation]);

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
