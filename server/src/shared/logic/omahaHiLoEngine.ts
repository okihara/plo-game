// Omaha Hi-Lo (8-or-Better) エンジン
// Fixed Limit: preflop/flop = small bet, turn/river = big bet
// ホールカード4枚、コミュニティカード5枚
// ショーダウン: ハイ/ローでポットをスプリット（8-or-betterクオリファイ）
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
import { omahaHiLoDescriptor } from './engine/variants/fixedLimitBoard.js';

export function createOmahaHiLoGameState(playerChips: number, smallBet: number, bigBet: number): GameState {
  return omahaHiLoDescriptor.createTableState('omaha_hilo', playerChips, smallBet, bigBet, 0);
}

export function startOmahaHiLoHand(state: GameState): GameState {
  return startHandCore(state, omahaHiLoDescriptor);
}

export function getOmahaHiLoValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  return getValidActionsCore(state, playerIndex, omahaHiLoDescriptor);
}

export function applyOmahaHiLoAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  return applyActionCore(state, playerIndex, action, amount, omahaHiLoDescriptor, rakePercent, rakeCapBB);
}

export function determineOmahaHiLoWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
  return determineWinnerCore(state, omahaHiLoDescriptor, rakePercent, rakeCapBB);
}

export function wouldOmahaHiLoAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, omahaHiLoDescriptor);
}
