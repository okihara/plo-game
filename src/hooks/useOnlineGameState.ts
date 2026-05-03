import { useState, useCallback, useEffect, useRef } from 'react';
import { wsService } from '../services/websocket';
import { playActionSound, playDealSound, playMyTurnSound } from '../services/actionSound';
import type { ClientGameState } from '@plo/shared';
import type { Card, Action, GameState } from '../logic/types';
import { convertClientStateToGameState } from './onlineGameShared';

// ============================================
// 型定義
// ============================================

export interface LastAction {
  action: Action;
  amount: number;
  timestamp: number;
  drawCount?: number;
  /** チップを動かしたアクション用: ストリート上のこのプレイヤーの合計ベット（アクション後）。未設定時は amount のみ表示 */
  displayChipTotal?: number;
}

// アクションタイムアウト時刻（UNIXタイムスタンプ、ミリ秒）
export type ActionTimeoutAt = number;

export type PrivateMode =
  | { type: 'create'; blinds: string }
  | { type: 'join'; inviteCode: string };

export interface OnlineGameHookResult {
  // 接続状態
  isConnecting: boolean;
  isConnected: boolean;
  connectionError: string | null;
  isDisplaced: boolean;

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
  privateTableInfo: { inviteCode: string } | null;

  // アクション
  connect: () => Promise<void>;
  disconnect: () => void;
  joinMatchmaking: () => void;
  leaveMatchmaking: () => void;
  handleAction: (action: Action, amount: number, discardIndices?: number[]) => void;
  handleFastFold: () => void;
  startNextHand: () => void;
}

// ============================================
// メインフック
// ============================================

export function useOnlineGameState(blinds: string = '1/3', isFastFold: boolean = false, privateMode?: PrivateMode, variant?: string): OnlineGameHookResult {
  // 接続状態
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(wsService.isConnected());
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isDisplaced, setIsDisplaced] = useState(false);

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
  const [privateTableInfo, setPrivateTableInfo] = useState<{ inviteCode: string } | null>(null);

  // Refs
  const prevStreetRef = useRef<string | null>(null);
  const prevCardCountRef = useRef(0);
  const dealingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientStateRef = useRef<ClientGameState | null>(null);
  const mySeatRef = useRef<number | null>(null);
  /** 直前の game:state で自分のターンだったか（重複再生防止） */
  const wasMyTurnRef = useRef(false);

  // ショウダウン演出タイミング用Refs
  const showdownRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winnersDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingShowdownHandNamesRef = useRef<Map<number, string> | null>(null);

  // Stud: 新ハンド判定用（onHoleCardsが複数ストリートで呼ばれるため）
  const isNewHandRef = useRef(true);
  /** ハンド間の演出クリア: 観戦同様に「新ハンド開始」(isHandInProgress false→true) でもクリアする */
  const prevIsHandInProgressRef = useRef(false);

  // ============================================
  // アクションマーカー管理（CSSアニメーションで自動フェードアウト）
  // ============================================

  const recordAction = useCallback((
    playerId: number,
    action: Action,
    amount: number,
    drawCount?: number,
    displayChipTotal?: number,
  ) => {
    setLastActions(prev => {
      const newMap = new Map(prev);
      newMap.set(playerId, { action, amount, timestamp: Date.now(), drawCount, displayChipTotal });
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
    if (privateMode?.type === 'create') {
      wsService.createPrivateTable(privateMode.blinds);
    } else if (privateMode?.type === 'join') {
      wsService.joinPrivateTable(privateMode.inviteCode);
    } else {
      wsService.joinMatchmaking(blinds, isFastFold, variant);
    }
  }, [blinds, isFastFold, privateMode, variant]);

  const leaveMatchmaking = useCallback(() => {
    wsService.leaveMatchmaking();
  }, []);

  // ============================================
  // ゲームアクション
  // ============================================

  const handleAction = useCallback((action: Action, amount: number, discardIndices?: number[]) => {
    wsService.sendAction(action, amount, discardIndices);
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
    mySeatRef.current = mySeat;
  }, [mySeat]);

  useEffect(() => {
    wsService.addListeners('game', {
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
      onTableJoined: (tid, seat) => {
        setTableId(tid);
        setMySeat(seat);
        setMyHoleCards([]);
        isNewHandRef.current = true;
        prevIsHandInProgressRef.current = false;
      },
      onTableLeft: () => {
        setTableId(null);
        setMySeat(null);
        setMyHoleCards([]);
        setClientState(null);
        setActionTimeoutAt(null);
        setPrivateTableInfo(null);
        setWinners([]);
        setShowdownCards(new Map());
        setShowdownHandNames(new Map());
        pendingShowdownHandNamesRef.current = null;
        prevIsHandInProgressRef.current = false;
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
          variant: prev?.variant ?? 'plo',
          ante: prev?.ante ?? 0,
          bringIn: 0,
          validActions: null,
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
        isNewHandRef.current = true;
        setTableId(tid);
        setMySeat(seat);
        prevIsHandInProgressRef.current = false;
      },
      onGameState: (state) => {
        // ファストフォールド移動後、新テーブルの状態が届いたらフラグクリア
        setIsChangingTable(false);

        const nowInProgress = state.isHandInProgress;
        const wasInProgress = prevIsHandInProgressRef.current;
        prevIsHandInProgressRef.current = nowInProgress;
        // 新ハンド開始: 観戦と同じ境界で WIN / ショウダウン / アクションマーカーをまとめてクリア
        if (!wasInProgress && nowInProgress) {
          setWinners([]);
          setShowdownCards(new Map());
          setShowdownHandNames(new Map());
          pendingShowdownHandNamesRef.current = null;
          setLastActions(new Map());
        }

        // ストリート変更検出
        if (prevStreetRef.current && state.currentStreet !== prevStreetRef.current && state.currentStreet !== 'showdown') {
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

        // 自分のターンになった瞬間だけサウンド再生（重複防止）
        const isMyTurn = state.currentPlayerSeat !== null && state.currentPlayerSeat === mySeatRef.current;
        if (isMyTurn && !wasMyTurnRef.current) {
          playMyTurnSound();
        }
        wasMyTurnRef.current = isMyTurn;

        prevStreetRef.current = state.currentStreet;
        prevCardCountRef.current = state.communityCards.length;
        // 内部は常に raw (1 単位整数) のまま下流へ流す。表示倍率 (×chipUnit) は
        // GameSettingsContext.formatChips が担当する。
        setClientState(state);

        // タイマー情報を更新
        setActionTimeoutAt(state.actionTimeoutAt ?? null);
        setActionTimeoutMs(state.actionTimeoutMs ?? null);
      },
      onHoleCards: ({ cards }) => {
        // サーバーは自席のカードしか送らないのでseatIndexチェック不要
        // Stud: 各ストリートで呼ばれる。新ハンド初回だけディール演出（演出リセットは onGameState の isHandInProgress 遷移に任せる）
        if (cards.length > 0 && isNewHandRef.current) {
          isNewHandRef.current = false;
          startDealingAnimation();
          playDealSound();
          prevStreetRef.current = null;
          prevCardCountRef.current = 0;
        }
        setMyHoleCards(cards);
      },
      onActionTaken: ({ playerId, action, amount, drawCount }) => {
        playActionSound(action);
        // アクション完了 → タイマーリング＆アクション待ちグローを即座にクリア
        setActionTimeoutAt(null);
        setClientState(prev => prev ? { ...prev, currentPlayerSeat: null } : prev);

        // playerIdからシート番号を取得（refで最新のclientStateを参照）
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
      onHandComplete: (serverWinners) => {
        isNewHandRef.current = true;
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
      onShowdown: ({ players: showdownPlayers, winners }) => {
        const cardsMap = new Map<number, Card[]>();
        const handNamesMap = new Map<number, string>();
        for (const p of showdownPlayers) {
          cardsMap.set(p.seatIndex, p.cards);
          if (p.handName) {
            handNamesMap.set(p.seatIndex, p.handName);
          }
        }
        const cs = clientStateRef.current;
        if (cs && winners?.length) {
          for (const w of winners) {
            if (!w.cards?.length) continue;
            const seat = cs.players.findIndex(pl => pl?.odId === w.playerId);
            if (seat >= 0) {
              cardsMap.set(seat, w.cards);
              if (w.handName) handNamesMap.set(seat, w.handName);
            }
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
      onPrivateCreated: (data) => {
        setPrivateTableInfo({ inviteCode: data.inviteCode });
        setTableId(data.tableId);
      },
      onDisplaced: () => {
        setIsDisplaced(true);
        setIsConnected(false);
      },
    });

    return () => {
      wsService.removeListeners('game');
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
    isDisplaced,
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
    privateTableInfo,
    connect,
    disconnect,
    joinMatchmaking,
    leaveMatchmaking,
    handleAction,
    handleFastFold,
    startNextHand,
  };
}
