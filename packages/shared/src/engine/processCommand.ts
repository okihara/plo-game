import type { GameState } from '../types.js';
import type { GameCommand, GameEvent, CommandResult } from './types.js';
import {
  startNewHand,
  applyAction,
  getValidActions,
  getActivePlayers,
} from './gameEngine.js';

export interface ProcessCommandOptions {
  rakePercent?: number;
  rakeCapBB?: number;
}

/**
 * ゲームエンジンの純粋関数: (State, Command) → (State, Event[])
 *
 * 既存の gameEngine 関数をラップし、状態遷移に加えて
 * 発生したイベントの配列を返す。
 */
export function processCommand(
  state: GameState,
  command: GameCommand,
  options?: ProcessCommandOptions
): CommandResult {
  switch (command.type) {
    case 'START_HAND':
      return handleStartHand(state);
    case 'PLAYER_ACTION':
      return handlePlayerAction(state, command, options);
    case 'TIMEOUT':
      return handleTimeout(state, command, options);
  }
}

function handleStartHand(state: GameState): CommandResult {
  const events: GameEvent[] = [];
  const newState = startNewHand(state);

  // ホールカードのイベント生成
  const holeCards = new Map<number, typeof newState.players[0]['holeCards']>();
  for (const p of newState.players) {
    if (!p.isSittingOut && p.holeCards.length > 0) {
      holeCards.set(p.id, p.holeCards);
    }
  }

  events.push({
    type: 'HAND_STARTED',
    dealerSeat: newState.dealerPosition,
    holeCards,
  });

  // ハンド開始時点でオールインランアウトが発生していた場合
  if (newState.isHandComplete) {
    events.push({ type: 'ALL_IN_RUNOUT', communityCards: newState.communityCards });
    if (getActivePlayers(newState).length > 1) {
      events.push({ type: 'SHOWDOWN_REACHED' });
    }
    events.push({
      type: 'HAND_COMPLETED',
      winners: newState.winners.map(w => ({
        playerId: w.playerId,
        amount: w.amount,
        handName: w.handName,
      })),
      rake: newState.rake,
    });
  }

  return { state: newState, events };
}

function handlePlayerAction(
  state: GameState,
  command: Extract<GameCommand, { type: 'PLAYER_ACTION' }>,
  options?: ProcessCommandOptions
): CommandResult {
  const events: GameEvent[] = [];
  const { seatIndex, action, amount = 0 } = command;

  // ターン確認
  if (state.currentPlayerIndex !== seatIndex) {
    return { state, events: [] };
  }

  // バリデーション
  const validActions = getValidActions(state, seatIndex);
  const matched = validActions.find(a => a.action === action);
  if (!matched) {
    return { state, events: [] };
  }

  // fold/check はamount不要、それ以外はamount範囲チェック
  if (action !== 'fold' && action !== 'check') {
    const effectiveAmount = action === 'call' || action === 'allin' ? matched.minAmount : amount;
    if (effectiveAmount < matched.minAmount || effectiveAmount > matched.maxAmount) {
      return { state, events: [] };
    }
  }

  const prevStreet = state.currentStreet;
  const prevCardCount = state.communityCards.length;
  const rakePercent = options?.rakePercent ?? 0;
  const rakeCapBB = options?.rakeCapBB ?? 0;

  const newState = applyAction(state, seatIndex, action, amount, rakePercent, rakeCapBB);

  events.push({ type: 'ACTION_APPLIED', seatIndex, action, amount });

  // ストリート変更の検出（ハンド完了でない場合）
  if (!newState.isHandComplete && newState.currentStreet !== prevStreet) {
    const newCards = newState.communityCards.slice(prevCardCount);
    events.push({ type: 'STREET_ADVANCED', street: newState.currentStreet, newCards });
  }

  // オールインランアウト検出（ハンド完了でカードが追加された場合）
  if (newState.isHandComplete && newState.communityCards.length > prevCardCount) {
    events.push({ type: 'ALL_IN_RUNOUT', communityCards: newState.communityCards });
  }

  // ショーダウン/ハンド完了
  if (newState.isHandComplete) {
    if (newState.currentStreet === 'showdown' && getActivePlayers(newState).length > 1) {
      events.push({ type: 'SHOWDOWN_REACHED' });
    }
    events.push({
      type: 'HAND_COMPLETED',
      winners: newState.winners.map(w => ({
        playerId: w.playerId,
        amount: w.amount,
        handName: w.handName,
      })),
      rake: newState.rake,
    });
  }

  return { state: newState, events };
}

function handleTimeout(
  state: GameState,
  command: Extract<GameCommand, { type: 'TIMEOUT' }>,
  options?: ProcessCommandOptions
): CommandResult {
  const { seatIndex } = command;

  // タイムアウト時: チェックできればチェック、さもなくばフォールド
  const validActions = getValidActions(state, seatIndex);
  const canCheck = validActions.some(a => a.action === 'check');

  return handlePlayerAction(
    state,
    {
      type: 'PLAYER_ACTION',
      seatIndex,
      action: canCheck ? 'check' : 'fold',
      amount: 0,
    },
    options
  );
}
