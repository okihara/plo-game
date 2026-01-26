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
    const initial = createInitialGameState();
    return startNewHand(initial);
  });
  const [lastActions, setLastActions] = useState<Map<number, LastAction>>(new Map());
  const [isProcessingCPU, setIsProcessingCPU] = useState(false);
  const [isDealingCards, setIsDealingCards] = useState(true);
  const [newCommunityCardsCount, setNewCommunityCardsCount] = useState(0);
  const [isChangingTable, setIsChangingTable] = useState(false);

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
    console.log('[scheduleNextCPUAction] 開始', {
      isHandComplete: state.isHandComplete,
      currentPlayerIndex: state.currentPlayerIndex,
      currentStreet: state.currentStreet,
    });

    // 既存のタイムアウトをキャンセル
    if (cpuTimeoutRef.current) {
      console.log('[scheduleNextCPUAction] 既存のタイムアウトをキャンセル');
      clearTimeout(cpuTimeoutRef.current);
      cpuTimeoutRef.current = null;
    }

    if (state.isHandComplete) {
      console.log('[scheduleNextCPUAction] ハンド完了のため終了');
      return;
    }

    const currentPlayer = state.players[state.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.isHuman) {
      console.log('[scheduleNextCPUAction] 人間プレイヤーのため終了', {
        currentPlayer: currentPlayer?.name,
        isHuman: currentPlayer?.isHuman,
      });
      return;
    }

    console.log('[scheduleNextCPUAction] CPUプレイヤーのアクション開始', {
      playerName: currentPlayer.name,
      playerId: currentPlayer.id,
      position: currentPlayer.position,
      chips: currentPlayer.chips,
    });

    setIsProcessingCPU(true);

    const thinkTime = 300 + Math.random() * 500;
    console.log('[scheduleNextCPUAction] 思考時間:', thinkTime.toFixed(0), 'ms');

    cpuTimeoutRef.current = setTimeout(() => {
      cpuTimeoutRef.current = null; // タイムアウト実行後にクリア

      setGameState(currentState => {
        console.log('[scheduleNextCPUAction] タイムアウト実行', {
          isHandComplete: currentState.isHandComplete,
          expectedPlayerIndex: state.currentPlayerIndex,
          actualPlayerIndex: currentState.currentPlayerIndex,
        });

        // 状態が変わっていたらスキップ（別のアクションが先に実行された）
        if (currentState.currentPlayerIndex !== state.currentPlayerIndex) {
          console.log('[scheduleNextCPUAction] プレイヤーインデックスが変わったためスキップ');
          setIsProcessingCPU(false);
          return currentState;
        }

        if (currentState.isHandComplete) {
          console.log('[scheduleNextCPUAction] タイムアウト内でハンド完了検出');
          setIsProcessingCPU(false);
          return currentState;
        }

        // 現在のプレイヤーが人間なら何もしない
        const actualCurrentPlayer = currentState.players[currentState.currentPlayerIndex];
        if (actualCurrentPlayer.isHuman) {
          console.log('[scheduleNextCPUAction] 現在のプレイヤーは人間のためスキップ');
          setIsProcessingCPU(false);
          return currentState;
        }

        const previousStreet = currentState.currentStreet;
        const prevCardCount = currentState.communityCards.length;
        const playerId = currentState.players[currentState.currentPlayerIndex].id;
        const cpuAction = getCPUAction(currentState, currentState.currentPlayerIndex);

        console.log('[scheduleNextCPUAction] CPUアクション決定', {
          playerId,
          action: cpuAction.action,
          amount: cpuAction.amount,
        });

        setLastActions(prev => {
          const newMap = new Map(prev);
          newMap.set(playerId, { ...cpuAction, timestamp: Date.now() });
          return newMap;
        });

        const newState = applyAction(currentState, currentState.currentPlayerIndex, cpuAction.action, cpuAction.amount);

        console.log('[scheduleNextCPUAction] アクション適用後', {
          previousStreet,
          newStreet: newState.currentStreet,
          pot: newState.pot,
          nextPlayerIndex: newState.currentPlayerIndex,
          isHandComplete: newState.isHandComplete,
        });

        // 最後のアクションを表示するための遅延付きクリア
        scheduleActionMarkerClear(playerId);

        if (newState.currentStreet !== previousStreet) {
          console.log('[scheduleNextCPUAction] ストリート変更検出');
          setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);

          // ストリート変更時は、アクション表示後に遅延を入れてから次へ進む
          setIsProcessingCPU(false);

          if (!newState.isHandComplete) {
            const nextPlayer = newState.players[newState.currentPlayerIndex];
            console.log('[scheduleNextCPUAction] 次のプレイヤー確認 (ストリート変更後)', {
              nextPlayerName: nextPlayer?.name,
              nextPlayerIsHuman: nextPlayer?.isHuman,
            });
            if (nextPlayer && !nextPlayer.isHuman) {
              console.log('[scheduleNextCPUAction] 次のCPUアクションをスケジュール (1000ms後)');
              setTimeout(() => {
                setLastActions(new Map());
                clearAllActionMarkerTimers();
                scheduleNextCPUAction(newState);
              }, 1000);
            } else {
              // 人間の番なら少し待ってからアクションマーカーをクリア
              setTimeout(() => {
                setLastActions(new Map());
                clearAllActionMarkerTimers();
              }, 1000);
            }
          } else {
            console.log('[scheduleNextCPUAction] ハンド完了');
          }
        } else {
          setNewCommunityCardsCount(0);
          setIsProcessingCPU(false);

          if (!newState.isHandComplete) {
            const nextPlayer = newState.players[newState.currentPlayerIndex];
            console.log('[scheduleNextCPUAction] 次のプレイヤー確認', {
              nextPlayerName: nextPlayer?.name,
              nextPlayerIsHuman: nextPlayer?.isHuman,
            });
            if (nextPlayer && !nextPlayer.isHuman) {
              console.log('[scheduleNextCPUAction] 次のCPUアクションをスケジュール (300ms後)');
              setTimeout(() => scheduleNextCPUAction(newState), 300);
            }
          } else {
            console.log('[scheduleNextCPUAction] ハンド完了');
          }
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

      // 人間がフォールドしたら「テーブル移動中」を表示して新しいハンドを開始
      if (action === 'fold') {
        // 既存のタイムアウトをキャンセル
        if (cpuTimeoutRef.current) {
          clearTimeout(cpuTimeoutRef.current);
          cpuTimeoutRef.current = null;
        }

        setLastActions(new Map());
        clearAllActionMarkerTimers();
        setIsChangingTable(true);

        // 0.7秒後にテーブル移動完了、新しいハンドを開始
        setTimeout(() => {
          setIsChangingTable(false);
          setGameState(prevState => {
            const stateWithRebuy = {
              ...prevState,
              players: prevState.players.map(p => ({
                ...p,
                chips: p.chips <= 0 ? 600 : p.chips,
              })),
            };
            const newState = startNewHand(stateWithRebuy);
            setIsDealingCards(true);
            setNewCommunityCardsCount(0);

            setTimeout(() => {
              setIsDealingCards(false);
              scheduleNextCPUAction(newState);
            }, 2000);

            return newState;
          });
        }, 700);

        return currentState;
      }

      const previousStreet = currentState.currentStreet;
      const prevCardCount = currentState.communityCards.length;
      const playerId = currentPlayer.id;

      setLastActions(prev => {
        const newMap = new Map(prev);
        newMap.set(playerId, { action, amount, timestamp: Date.now() });
        return newMap;
      });

      const newState = applyAction(currentState, currentState.currentPlayerIndex, action, amount);

      // 人間のアクションを表示するための遅延付きクリア
      scheduleActionMarkerClear(playerId);

      if (newState.currentStreet !== previousStreet) {
        setNewCommunityCardsCount(newState.communityCards.length - prevCardCount);

        // ストリート変更時は、アクション表示後に遅延を入れてから次へ進む
        if (!newState.isHandComplete) {
          setTimeout(() => {
            setLastActions(new Map());
            clearAllActionMarkerTimers();
            scheduleNextCPUAction(newState);
          }, 1000);
        }
      } else {
        setNewCommunityCardsCount(0);

        if (!newState.isHandComplete) {
          setTimeout(() => scheduleNextCPUAction(newState), 300);
        }
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
          chips: p.chips <= 0 ? 600 : p.chips,
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
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    handleAction,
    startNextHand,
  };
}
