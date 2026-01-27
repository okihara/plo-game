import { useState, useCallback, useRef, useEffect } from 'react';
import {
  GameState,
  Action,
  createInitialGameState,
  startNewHand,
  applyAction,
  getValidActions,
  getCPUAction,
} from '../logic';

// ============================================
// 型定義
// ============================================

export interface LastAction {
  action: Action;
  amount: number;
  timestamp: number;
}

// ============================================
// 定数
// ============================================

/** アクションマーカーの表示時間 (ms) */
const ACTION_MARKER_DISPLAY_TIME = 1000;

/** ストリート変更後の待機時間 (ms) */
const STREET_CHANGE_DELAY = 1000;

/** 同一ストリート内でのCPUアクション間隔 (ms) */
const CPU_ACTION_INTERVAL = 300;

/** CPUの最小思考時間 (ms) */
const CPU_THINK_TIME_MIN = 300;

/** CPUの思考時間の揺らぎ (ms) */
const CPU_THINK_TIME_VARIANCE = 500;

/** カード配布アニメーション時間 (ms) */
const DEAL_ANIMATION_TIME = 2000;

/** テーブル移動時間 (ms) */
const TABLE_CHANGE_DELAY = 700;

/** チップがなくなった時のリバイ額 */
const REBUY_AMOUNT = 600;

// ============================================
// ヘルパー関数
// ============================================

/** ランダムな思考時間を生成 */
const getRandomThinkTime = (): number =>
  CPU_THINK_TIME_MIN + Math.random() * CPU_THINK_TIME_VARIANCE;

/** プレイヤーのチップをリバイで補充した状態を返す */
const applyRebuyIfNeeded = (state: GameState): GameState => ({
  ...state,
  players: state.players.map(p => ({
    ...p,
    chips: p.chips <= 0 ? REBUY_AMOUNT : p.chips,
  })),
});

/** 次のプレイヤーがCPUかどうか判定 */
const isNextPlayerCPU = (state: GameState): boolean => {
  const nextPlayer = state.players[state.currentPlayerIndex];
  return nextPlayer != null && !nextPlayer.isHuman;
};

// ============================================
// メインフック
// ============================================

export function useGameState() {
  // --- State ---
  const [gameState, setGameState] = useState<GameState>(() => {
    const initial = createInitialGameState();
    return startNewHand(initial);
  });
  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [isProcessingCPU, setIsProcessingCPU] = useState(false);
  const [isDealingCards, setIsDealingCards] = useState(true);
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);
  const [isChangingTable, setIsChangingTable] = useState(false);

  // --- Refs ---
  const actionMarkerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const cpuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============================================
  // アクションマーカー管理
  // ============================================

  /** 全てのアクションマーカータイマーをクリア */
  const clearAllActionMarkerTimers = useCallback(() => {
    actionMarkerTimersRef.current.forEach(timer => clearTimeout(timer));
    actionMarkerTimersRef.current.clear();
  }, []);

  /** 指定プレイヤーのアクションマーカーを一定時間後にクリアするタイマーを設定 */
  const scheduleActionMarkerClear = useCallback((playerId: number) => {
    // 既存のタイマーがあればクリア
    const existingTimer = actionMarkerTimersRef.current.get(playerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

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

  /** アクションを記録する */
  const recordAction = useCallback((playerId: number, action: Action, amount: number) => {
    setLastActions(prev => {
      const newMap = new Map(prev);
      newMap.set(playerId, { action, amount, timestamp: Date.now() });
      return newMap;
    });
  }, []);

  /** 全アクションマーカーをクリア */
  const clearAllActions = useCallback(() => {
    setLastActions(new Map());
    clearAllActionMarkerTimers();
  }, [clearAllActionMarkerTimers]);

  // ============================================
  // CPUアクションスケジューリング
  // ============================================

  /** 進行中のCPUタイムアウトをキャンセル */
  const cancelPendingCPUAction = useCallback(() => {
    if (cpuTimeoutRef.current) {
      clearTimeout(cpuTimeoutRef.current);
      cpuTimeoutRef.current = null;
    }
  }, []);

  /** 次のCPUアクションをスケジュール */
  const scheduleNextCPUAction = useCallback((state: GameState) => {
    cancelPendingCPUAction();

    // ハンド完了または人間の番なら何もしない
    if (state.isHandComplete) return;
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isHuman) return;

    setIsProcessingCPU(true);

    cpuTimeoutRef.current = setTimeout(() => {
      cpuTimeoutRef.current = null;

      setGameState(currentState => {
        // 状態の整合性チェック
        if (currentState.currentPlayerIndex !== state.currentPlayerIndex) {
          setIsProcessingCPU(false);
          return currentState;
        }
        if (currentState.isHandComplete) {
          setIsProcessingCPU(false);
          return currentState;
        }
        const actualPlayer = currentState.players[currentState.currentPlayerIndex];
        if (actualPlayer.isHuman) {
          setIsProcessingCPU(false);
          return currentState;
        }

        // CPUアクションを実行
        const previousStreet = currentState.currentStreet;
        const prevCardCount = currentState.communityCards.length;
        const playerId = actualPlayer.id;
        const cpuAction = getCPUAction(currentState, currentState.currentPlayerIndex);

        recordAction(playerId, cpuAction.action, cpuAction.amount);
        const newState = applyAction(currentState, currentState.currentPlayerIndex, cpuAction.action, cpuAction.amount);
        scheduleActionMarkerClear(playerId);

        const streetChanged = newState.currentStreet !== previousStreet;
        setIsProcessingCPU(false);

        if (streetChanged) {
          // ストリート変更時: コミュニティカード追加を反映
          setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);

          if (!newState.isHandComplete) {
            setTimeout(() => {
              clearAllActions();
              if (isNextPlayerCPU(newState)) {
                scheduleNextCPUAction(newState);
              }
            }, STREET_CHANGE_DELAY);
          }
        } else {
          // 同一ストリート: 次のCPUアクションへ
          setNewCommunityCardsCount(0);

          if (!newState.isHandComplete && isNextPlayerCPU(newState)) {
            setTimeout(() => scheduleNextCPUAction(newState), CPU_ACTION_INTERVAL);
          }
        }

        return newState;
      });
    }, getRandomThinkTime());
  }, [cancelPendingCPUAction, recordAction, scheduleActionMarkerClear, clearAllActions]);

  // ============================================
  // ハンド管理
  // ============================================

  /** 新しいハンドを開始する内部処理 */
  const startNewHandWithAnimation = useCallback((state: GameState) => {
    const stateWithRebuy = applyRebuyIfNeeded(state);
    const newState = startNewHand(stateWithRebuy);

    clearAllActions();
    setIsDealingCards(true);
    setNewCommunityCardsCount(0);

    setTimeout(() => {
      setIsDealingCards(false);
      scheduleNextCPUAction(newState);
    }, DEAL_ANIMATION_TIME);

    return newState;
  }, [clearAllActions, scheduleNextCPUAction]);

  /** 次のハンドを開始 (外部API) */
  const startNextHand = useCallback(() => {
    setGameState(currentState => startNewHandWithAnimation(currentState));
  }, [startNewHandWithAnimation]);

  // ============================================
  // プレイヤーアクション処理
  // ============================================

  /** 人間プレイヤーのフォールド処理 */
  const handleHumanFold = useCallback((currentState: GameState) => {
    cancelPendingCPUAction();
    clearAllActions();
    setIsChangingTable(true);

    setTimeout(() => {
      setIsChangingTable(false);
      setGameState(prevState => startNewHandWithAnimation(prevState));
    }, TABLE_CHANGE_DELAY);

    return currentState; // フォールド時は即座に状態を変えない（テーブル移動演出のため）
  }, [cancelPendingCPUAction, clearAllActions, startNewHandWithAnimation]);

  /** 人間プレイヤーのアクション処理 */
  const handleAction = useCallback((action: Action, amount: number) => {
    setGameState(currentState => {
      // バリデーション
      if (currentState.isHandComplete) return currentState;
      const currentPlayer = currentState.players[currentState.currentPlayerIndex];
      if (!currentPlayer.isHuman) return currentState;

      const validActions = getValidActions(currentState, currentState.currentPlayerIndex);
      const isValid = validActions.some(a => a.action === action);
      if (!isValid) return currentState;

      // フォールドは特別処理
      if (action === 'fold') {
        return handleHumanFold(currentState);
      }

      // 通常のアクション処理
      const previousStreet = currentState.currentStreet;
      const prevCardCount = currentState.communityCards.length;
      const playerId = currentPlayer.id;

      recordAction(playerId, action, amount);
      const newState = applyAction(currentState, currentState.currentPlayerIndex, action, amount);
      scheduleActionMarkerClear(playerId);

      const streetChanged = newState.currentStreet !== previousStreet;

      if (streetChanged) {
        setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);

        if (!newState.isHandComplete) {
          setTimeout(() => {
            clearAllActions();
            scheduleNextCPUAction(newState);
          }, STREET_CHANGE_DELAY);
        }
      } else {
        setNewCommunityCardsCount(0);

        if (!newState.isHandComplete) {
          setTimeout(() => scheduleNextCPUAction(newState), CPU_ACTION_INTERVAL);
        }
      }

      return newState;
    });
  }, [handleHumanFold, recordAction, scheduleActionMarkerClear, clearAllActions, scheduleNextCPUAction]);

  // ============================================
  // 初期化
  // ============================================

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsDealingCards(false);
      scheduleNextCPUAction(gameState);
    }, DEAL_ANIMATION_TIME);

    return () => {
      clearTimeout(timer);
      cancelPendingCPUAction();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================
  // 公開API
  // ============================================

  return {
    gameState,
    lastActions,
    isProcessingCPU,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    handleAction,
    startNextHand,
  };
}
