// Limit Hold'em エンジン
// Fixed Limit: preflop/flop = small bet, turn/river = big bet
// ホールカード2枚、コミュニティカード5枚、ベストハンドは7枚から最強5枚
//
// 実装は engine/ の共通コア + 記述子（engine/variants/fixedLimitBoard.ts）に移行済み。

import { GameState, Action } from './types.js';
import {
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineWinnerCore,
} from './engine/core.js';
import { limitHoldemDescriptor } from './engine/variants/fixedLimitBoard.js';

export function createLimitHoldemGameState(playerChips: number, smallBet: number, bigBet: number): GameState {
  return limitHoldemDescriptor.createTableState('limit_holdem', playerChips, smallBet, bigBet, 0);
}

export function startLimitHoldemHand(state: GameState): GameState {
  return startHandCore(state, limitHoldemDescriptor);
}

export function getLimitHoldemValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  return getValidActionsCore(state, playerIndex, limitHoldemDescriptor);
}

export function applyLimitHoldemAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0
): GameState {
  return applyActionCore(state, playerIndex, action, amount, limitHoldemDescriptor, rakePercent, rakeCapBB);
}

export function determineLimitHoldemWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  return determineWinnerCore(state, limitHoldemDescriptor, rakePercent, rakeCapBB);
}

export function wouldLimitHoldemAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, limitHoldemDescriptor);
}
