import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import { playActionSound, playDealSound } from '../services/actionSound';
import type { ClientGameState, OnlinePlayer } from '@plo/shared';
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
  showdownHandNames: Map<number, string>;
  maintenanceStatus: { isActive: boolean; message: string } | null;
  announcementStatus: { isActive: boolean; message: string } | null;
  bustedMessage: string | null;

  // アクション
  connect: () => Promise<void>;
  disconnect: () => void;
  joinMatchmaking: () => void;
  leaveMatchmaking: () => void;
  handleAction: (action: Action, amount: number) => void;
  handleFastFold: () => void;
  startNextHand: () => void;
}

// ============================================
// 定数
// ============================================

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

function convertClientStateToGameState(
  clientState: ClientGameState,
  myHoleCards: Card[],
  mySeat: number | null,
  showdownCards: Map<number, Card[]>
): GameState {
  const players = clientState.players.map((p, i) =>
    convertOnlinePlayerToPlayer(p, i, clientState.dealerSeat)
  );

  // 自分のホールカードを設定
  if (mySeat !== null && players[mySeat]) {
    players[mySeat].holeCards = myHoleCards;
  }

  // ショウダウン時の他プレイヤーのカードを設定
  for (const [seatIndex, cards] of showdownCards) {
    if (players[seatIndex] && seatIndex !== mySeat) {
      players[seatIndex].holeCards = cards;
    }
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
    currentPlayerIndex: clientState.currentPlayerSeat ?? -1,
    lastRaiserIndex: -1,
    lastFullRaiseBet: 0,
    handHistory: [],
    isHandComplete: !clientState.isHandInProgress,
    winners: [],
    rake: clientState.rake ?? 0,
  };
}

// ============================================
// メインフック
// ============================================

export function useOnlineGameState(blinds: string = '1/3', isFastFold: boolean = false): OnlineGameHookResult {
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
  const [showdownCards, setShowdownCards] = useState<Map<number, Card[]>>(new Map());
  const [showdownHandNames, setShowdownHandNames] = useState<Map<number, string>>(new Map());
  const [maintenanceStatus, setMaintenanceStatus] = useState<{ isActive: boolean; message: string } | null>(null);
  const [announcementStatus, setAnnouncementStatus] = useState<{ isActive: boolean; message: string } | null>(null);
  const [bustedMessage, setBustedMessage] = useState<string | null>(null);

  // Refs
  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const dealingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientStateRef = useRef<ClientGameState | null>(null);

  // ショウダウン演出タイミング用Refs
  const showdownRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winnersDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShowdownHandNamesRef = useRef<Map<number, string> | null>(null);

  // ============================================
  // アクションマーカー管理（CSSアニメーションで自動フェードアウト）
  // ============================================

  const recordAction = useCallback((playerId: number, action: Action, amount: number) => {
    setLastActions(prev => {
      const newMap = new Map(prev);
      newMap.set(playerId, { action, amount, timestamp: Date.now() });
      return newMap;
    });
  }, []);

  const clearAllActionMarkers = useCallback(() => {
    setLastActions(new Map());
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
    wsService.joinMatchmaking(blinds, isFastFold);
  }, [blinds, isFastFold]);

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

  const handleFastFold = useCallback(() => {
    wsService.sendFastFold();
  }, []);

  const startNextHand = useCallback(() => {
    // サーバー側で自動的に次のハンドが始まるので、クライアントでは何もしない
    // 必要であればサーバーに準備完了を通知
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
      onTableChanged: (tid, seat) => {
        // ファストフォールド: テーブル移動
        setIsChangingTable(true);
        setClientState(prev => ({
          tableId: tid,
          players: Array(6).fill(null),
          communityCards: [],
          pot: 0,
          sidePots: [],
          currentStreet: 'preflop',
          dealerSeat: 0,
          currentPlayerSeat: null,
          currentBet: 0,
          minRaise: 0,
          smallBlind: prev?.smallBlind ?? 0,
          bigBlind: prev?.bigBlind ?? 0,
          isHandInProgress: false,
          actionTimeoutAt: null,
          actionTimeoutMs: null,
          rake: 0,
        }));
        setMyHoleCards([]);
        setShowdownCards(new Map());
        setShowdownHandNames(new Map());
        setWinners([]);
        setLastActions(new Map());
        setActionTimeoutAt(null);
        setActionTimeoutMs(null);
        prevStreetRef.current = null;
        prevCardCountRef.current = 0;
        pendingShowdownHandNamesRef.current = null;
        setTableId(tid);
        setMySeat(seat);
      },
      onGameState: (state) => {
        // ファストフォールド移動後、新テーブルの状態が届いたらフラグクリア
        setIsChangingTable(false);

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
          console.log('onHoleCards', cards);
          pendingShowdownHandNamesRef.current = null;
          startDealingAnimation();
          playDealSound();
          prevStreetRef.current = null;
          prevCardCountRef.current = 0;
          setWinners([]); // 新しいハンド開始時にwinnersをクリア
          setLastActions(new Map()); // アクションマーカーもクリア
          setShowdownCards(new Map()); // ショウダウンカードもクリア
          setShowdownHandNames(new Map()); // ショウダウン役名もクリア
        }
        setMyHoleCards(cards);
      },
      onActionTaken: ({ playerId, action, amount }) => {
        playActionSound(action);
        // アクション完了 → タイマーリング＆アクション待ちグローを即座にクリア
        setActionTimeoutAt(null);
        setClientState(prev => prev ? { ...prev, currentPlayerSeat: null } : prev);

        // playerIdからシート番号を取得（refで最新のclientStateを参照）
        const currentState = clientStateRef.current;
        const seat = currentState?.players.findIndex(p => p?.odId === playerId);
        if (seat !== undefined && seat >= 0) {
          recordAction(seat, action, amount);
        }
      },
      onActionRequired: () => {
        // playMyTurnSound();
      },
      onHandComplete: (serverWinners) => {
        const currentState = clientStateRef.current;
        if (currentState) {
          const convertedWinners = serverWinners.map(w => {
          // playerIdをseat番号に変換（refで最新のclientStateを参照）
          const seat = currentState.players.findIndex(p => p?.odId === w.playerId);
            return {
              playerId: seat,  // -1 = 不明（UI側でハイライトされないだけ）
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
          if (p.handName) {
            handNamesMap.set(p.seatIndex, p.handName);
          }
        }
        // カードを公開（役名はhand_completeで表示）
        setShowdownCards(cardsMap);
        pendingShowdownHandNamesRef.current = handNamesMap;
      },
      onBusted: (message) => {
        setBustedMessage(message);
      },
      onMaintenanceStatus: (data) => {
        setMaintenanceStatus(data);
      },
      onAnnouncementStatus: (data) => {
        setAnnouncementStatus(data);
      },
    });

    return () => {
      clearAllActionMarkers();
      if (dealingTimerRef.current) {
        clearTimeout(dealingTimerRef.current);
        dealingTimerRef.current = null;
      }
      if (showdownRevealTimerRef.current) {
        clearTimeout(showdownRevealTimerRef.current);
        showdownRevealTimerRef.current = null;
      }
      if (winnersDisplayTimerRef.current) {
        clearTimeout(winnersDisplayTimerRef.current);
        winnersDisplayTimerRef.current = null;
      }
    };
  }, [clearAllActionMarkers, recordAction, startDealingAnimation]);

  // ============================================
  // 変換されたGameState
  // ============================================

  const baseGameState = clientState
    ? convertClientStateToGameState(clientState, myHoleCards, mySeat, showdownCards)
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
    showdownHandNames,
    maintenanceStatus,
    announcementStatus,
    bustedMessage,
    connect,
    disconnect,
    joinMatchmaking,
    leaveMatchmaking,
    handleAction,
    handleFastFold,
    startNextHand,
  };
}
