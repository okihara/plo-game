// Draw 系（Limit 2-7 Triple Draw / No-Limit 2-7 Single Draw）エンジン
// ベッティングとドロー（カード交換）が交互に進む。
//
// 実装は engine/ の共通コア + 記述子（engine/variants/draw.ts）に移行済み。

import { GameState, Action } from './types.js';
import {
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineWinnerCore,
} from './engine/core.js';
import { drawDescriptorFor, createDrawBaseState } from './engine/variants/draw.js';

export { isDrawStreet } from './types.js';
export { isBettingStreet, getDrawStreetOrder } from './engine/variants/draw.js';

export function createDrawGameState(playerChips: number, smallBet: number, maxDraws: number = 3): GameState {
  return createDrawBaseState(playerChips, smallBet, maxDraws);
}

export function startDrawHand(state: GameState): GameState {
  return startHandCore(state, drawDescriptorFor(state));
}

export function getDrawValidActions(
  state: GameState, playerIndex: number
): { action: Action; minAmount: number; maxAmount: number }[] {
  return getValidActionsCore(state, playerIndex, drawDescriptorFor(state));
}

export function applyDrawAction(
  state: GameState, playerIndex: number, action: Action, amount: number = 0,
  rakePercent: number = 0, rakeCapBB: number = 0, discardIndices?: number[]
): GameState {
  return applyActionCore(state, playerIndex, action, amount, drawDescriptorFor(state), rakePercent, rakeCapBB, discardIndices);
}

export function wouldDrawAdvanceStreet(
  state: GameState, playerIndex: number, action: Action, amount: number = 0, discardIndices?: number[]
): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, drawDescriptorFor(state), discardIndices);
}

export function determineDrawWinner(
  state: GameState, rakePercent: number = 0, rakeCapBB: number = 0
): GameState {
  return determineWinnerCore(state, drawDescriptorFor(state), rakePercent, rakeCapBB);
}
