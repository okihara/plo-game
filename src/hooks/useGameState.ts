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

export interface LastAction {
  action: Action;
  amount: number;
  timestamp: number;
}

export function useGameState() {
  const [gameState, setGameState] = useState<GameState>(() => {
    const initial = createInitialGameState(10000);
    return startNewHand(initial);
  });
  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [isProcessingCPU, setIsProcessingCPU] = useState(false);
  const [isTableTransition, setIsTableTransition] = useState(false);
  const [isDealingCards, setIsDealingCards] = useState(true);
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);

  const actionMarkerTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const cpuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAllActionMarkerTimers = useCallback(() => {
    actionMarkerTimersRef.current.forEach(timer => clearTimeout(timer));
    actionMarkerTimersRef.current.clear();
  }, []);

  const scheduleActionMarkerClear = useCallback((playerId: number) => {
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
    }, 1000);

    actionMarkerTimersRef.current.set(playerId, timer);
  }, []);

  const scheduleNextCPUAction = useCallback((state: GameState) => {
    if (state.isHandComplete) return;

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isHuman) return;

    setIsProcessingCPU(true);

    const thinkTime = 800 + Math.random() * 1200;

    cpuTimeoutRef.current = setTimeout(() => {
      setGameState(currentState => {
        if (currentState.isHandComplete) {
          setIsProcessingCPU(false);
          return currentState;
        }

        const previousStreet = currentState.currentStreet;
        const prevCardCount = currentState.communityCards.length;
        const playerId = currentState.players[currentState.currentPlayerIndex].id;
        const cpuAction = getCPUAction(currentState, currentState.currentPlayerIndex);

        setLastActions(prev => {
          const newMap = new Map(prev);
          newMap.set(playerId, { ...cpuAction, timestamp: Date.now() });
          return newMap;
        });

        const newState = applyAction(currentState, currentState.currentPlayerIndex, cpuAction.action, cpuAction.amount);

        if (newState.currentStreet !== previousStreet) {
          setLastActions(new Map());
          clearAllActionMarkerTimers();
          setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);
        } else {
          setNewCommunityCardsCount(0);
          scheduleActionMarkerClear(playerId);
        }

        setIsProcessingCPU(false);

        if (!newState.isHandComplete) {
          setTimeout(() => scheduleNextCPUAction(newState), 300);
        }

        return newState;
      });
    }, thinkTime);
  }, [clearAllActionMarkerTimers, scheduleActionMarkerClear]);

  const handleAction = useCallback((action: Action, amount: number) => {
    setGameState(currentState => {
      if (currentState.isHandComplete) return currentState;

      const currentPlayer = currentState.players[currentState.currentPlayerIndex];
      if (!currentPlayer.isHuman) return currentState;

      const validActions = getValidActions(currentState, currentState.currentPlayerIndex);
      const isValid = validActions.some(a => a.action === action);
      if (!isValid) return currentState;

      const previousStreet = currentState.currentStreet;
      const prevCardCount = currentState.communityCards.length;
      const playerId = currentPlayer.id;

      setLastActions(prev => {
        const newMap = new Map(prev);
        newMap.set(playerId, { action, amount, timestamp: Date.now() });
        return newMap;
      });

      const newState = applyAction(currentState, currentState.currentPlayerIndex, action, amount);

      if (newState.currentStreet !== previousStreet) {
        setLastActions(new Map());
        clearAllActionMarkerTimers();
        setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);
      } else {
        setNewCommunityCardsCount(0);
        scheduleActionMarkerClear(playerId);
      }

      if (action === 'fold') {
        setIsTableTransition(true);
        setTimeout(() => {
          setIsTableTransition(false);
          startNextHandInternal();
        }, 1000);
        return newState;
      }

      if (!newState.isHandComplete) {
        setTimeout(() => scheduleNextCPUAction(newState), 300);
      }

      return newState;
    });
  }, [clearAllActionMarkerTimers, scheduleActionMarkerClear, scheduleNextCPUAction]);

  const startNextHandInternal = useCallback(() => {
    setGameState(currentState => {
      const stateWithRebuy = {
        ...currentState,
        players: currentState.players.map(p => ({
          ...p,
          chips: p.chips <= 0 ? 10000 : p.chips,
        })),
      };
      const newState = startNewHand(stateWithRebuy);
      setLastActions(new Map());
      clearAllActionMarkerTimers();
      setIsDealingCards(true);
      setNewCommunityCardsCount(0);

      setTimeout(() => {
        setIsDealingCards(false);
        scheduleNextCPUAction(newState);
      }, 2000);

      return newState;
    });
  }, [clearAllActionMarkerTimers, scheduleNextCPUAction]);

  const startNextHand = useCallback(() => {
    startNextHandInternal();
  }, [startNextHandInternal]);

  // Initial deal animation
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsDealingCards(false);
      scheduleNextCPUAction(gameState);
    }, 2000);

    return () => {
      clearTimeout(timer);
      if (cpuTimeoutRef.current) {
        clearTimeout(cpuTimeoutRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    gameState,
    lastActions,
    isProcessingCPU,
    isTableTransition,
    isDealingCards,
    newCommunityCardsCount,
    handleAction,
    startNextHand,
  };
}
