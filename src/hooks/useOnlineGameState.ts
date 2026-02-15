import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import type { ClientGameState, OnlinePlayer } from '../../server/src/shared/types/websocket';
import type { Card, Action, GameState, Player, Position } from '../logic/types';

// ============================================
// 型定義
// ============================================

export interface LastAction {
  action: Action;
  amount: number;
  timestamp: number;
}

// アクションタイムアウト時刻（UNIXタイムスタンプ、ミリ秒）
export type ActionTimeoutAt = number;

export interface OnlineGameHookResult {
  // 接続状態
  isConnecting: boolean;
  isConnected: boolean;
  connectionError: string | null;

  // ゲーム状態
  gameState: GameState | null;
  tableId: string | null;
  mySeat: number | null;
  myHoleCards: Card[];

  // UI状態
  lastActions: Map<number, LastAction>;
  isProcessingCPU: boolean;
  isDealingCards: boolean;
  newCommunityCardsCount: number;
  isChangingTable: boolean;
  isWaitingForPlayers: boolean;
  seatedPlayerCount: number;
  actionTimeoutAt: ActionTimeoutAt | null;
  actionTimeoutMs: number | null;

  // アクション
  connect: () => Promise<void>;
  disconnect: () => void;
  joinMatchmaking: () => void;
  leaveMatchmaking: () => void;
  handleAction: (action: Action, amount: number) => void;
  startNextHand: () => void;
}

// ============================================
// 定数
// ============================================

const ACTION_MARKER_DISPLAY_TIME = 1000;
const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

// ============================================
// ヘルパー関数
// ============================================

function convertOnlinePlayerToPlayer(
  online: OnlinePlayer | null,
  index: number,
  dealerSeat: number
): Player {
  if (!online) {
    // 空席
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
    position: POSITIONS[posIndex],
    avatarId: online.avatarId,
    avatarUrl: online.avatarUrl,
    odId: online.odId,
  };
}

function convertClientStateToGameState(
  clientState: ClientGameState,
  myHoleCards: Card[],
  mySeat: number | null
): GameState {
  const players = clientState.players.map((p, i) =>
    convertOnlinePlayerToPlayer(p, i, clientState.dealerSeat)
  );

  // 自分のホールカードを設定
  if (mySeat !== null && players[mySeat]) {
    players[mySeat].holeCards = myHoleCards;
  }

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
  };
}

// ============================================
// メインフック
// ============================================

export function useOnlineGameState(blinds: string = '1/3'): OnlineGameHookResult {
  // 接続状態
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // ゲーム状態
  const [clientState, setClientState] = useState<ClientGameState | null>(null);
  const [tableId, setTableId] = useState<string | null>(null);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [myHoleCards, setMyHoleCards] = useState<Card[]>([]);

  // UI状態
  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [isDealingCards, setIsDealingCards] = useState(false);
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);
  const [isChangingTable, setIsChangingTable] = useState(false);
  const [actionTimeoutAt, setActionTimeoutAt] = useState<ActionTimeoutAt | null>(null);
  const [actionTimeoutMs, setActionTimeoutMs] = useState<number | null>(null);
  const [winners, setWinners] = useState<{ playerId: number; amount: number; handName: string }[]>([]);

  // Refs
  const actionMarkerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const dealingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    wsService.disconnect();
    setIsConnected(false);
    setTableId(null);
    setMySeat(null);
    setMyHoleCards([]);
    setClientState(null);
  }, []);

  // ============================================
  // Matchmaking
  // ============================================

  const joinMatchmaking = useCallback(() => {
    wsService.joinMatchmaking(blinds);
  }, [blinds]);

  const leaveMatchmaking = useCallback(() => {
    wsService.leaveMatchmaking();
  }, []);

  // ============================================
  // ゲームアクション
  // ============================================

  const handleAction = useCallback((action: Action, amount: number) => {
    wsService.sendAction(action, amount);
    setActionTimeoutAt(null);
  }, []);

  const startNextHand = useCallback(() => {
    // サーバー側で自動的に次のハンドが始まるので、クライアントでは何もしない
    // 必要であればサーバーに準備完了を通知
  }, []);

  // ============================================
  // イベントリスナー設定
  // ============================================

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
      onTableJoined: (tid, seat) => {
        setTableId(tid);
        setMySeat(seat);
        setMyHoleCards([]);
        // カード配布アニメーションはonHoleCardsで開始される
      },
      onTableLeft: () => {
        setTableId(null);
        setMySeat(null);
        setMyHoleCards([]);
        setClientState(null);
        setActionTimeoutAt(null);
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
        // タイマー情報を更新
        setActionTimeoutAt(state.actionTimeoutAt ?? null);
        setActionTimeoutMs(state.actionTimeoutMs ?? null);
      },
      onHoleCards: (cards) => {
        // 新しいハンドが開始されたらカード配布アニメーションとwinnersクリア
        if (cards.length > 0) {
          startDealingAnimation();
          prevStreetRef.current = null;
          prevCardCountRef.current = 0;
          setWinners([]); // 新しいハンド開始時にwinnersをクリア
        }
        setMyHoleCards(cards);
      },
      onActionTaken: ({ playerId, action, amount }) => {
        // playerIdからシート番号を取得
        const seat = clientState?.players.findIndex(p => p?.odId === playerId);
        if (seat !== undefined && seat >= 0) {
          recordAction(seat, action, amount);
        }
      },
      onHandComplete: (serverWinners) => {
        // playerIdをseat番号に変換
        if (clientState) {
          const convertedWinners = serverWinners.map(w => {
            const seat = clientState.players.findIndex(p => p?.odId === w.playerId);
            return {
              playerId: seat >= 0 ? seat : 0,
              amount: w.amount,
              handName: w.handName,
            };
          });
          setWinners(convertedWinners);
        }
      },
      onFastFoldQueued: () => {
        setIsChangingTable(true);
      },
      onFastFoldTableAssigned: (newTableId: string) => {
        setTableId(newTableId);
        setIsChangingTable(false);
        setMyHoleCards([]);
        // カード配布アニメーションはonHoleCardsで開始される
      },
    });

    return () => {
      clearAllActionMarkerTimers();
    };
  }, [clientState, clearAllActionMarkerTimers, recordAction, startDealingAnimation]);

  // ============================================
  // 変換されたGameState
  // ============================================

  const baseGameState = clientState
    ? convertClientStateToGameState(clientState, myHoleCards, mySeat)
    : null;

  const gameState = baseGameState
    ? {
        ...baseGameState,
        winners,
        // winnersがある場合はisHandCompleteをtrueに
        isHandComplete: baseGameState.isHandComplete || winners.length > 0,
      }
    : null;

  // 他のプレイヤーのターンかどうか
  const isProcessingCPU = gameState
    ? gameState.currentPlayerIndex !== mySeat
    : false;

  // 着席しているプレイヤー数
  const seatedPlayerCount = clientState
    ? clientState.players.filter(p => p !== null).length
    : 0;

  // 他のプレイヤーを待っている状態かどうか
  const isWaitingForPlayers = clientState !== null && !clientState.isHandInProgress;

  return {
    isConnecting,
    isConnected,
    connectionError,
    gameState,
    tableId,
    mySeat,
    myHoleCards,
    lastActions,
    isProcessingCPU,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    isWaitingForPlayers,
    seatedPlayerCount,
    actionTimeoutAt,
    actionTimeoutMs,
    connect,
    disconnect,
    joinMatchmaking,
    leaveMatchmaking,
    handleAction,
    startNextHand,
  };
}
