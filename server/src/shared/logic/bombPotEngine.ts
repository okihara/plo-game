// PLO Double Board Bomb Pot エンジン
//
// 仕様詳細: docs/double-board-bomb-pot.md
//
// 実装は engine/ の共通コア + 記述子（engine/variants/bombPot.ts）に移行済み。

import { GameState, Action } from './types.js';
import {
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineWinnerCore,
} from './engine/core.js';
import { bombPotDescriptor, createBombPotBaseState } from './engine/variants/bombPot.js';

/**
 * Bomb pot 用の初期 GameState を作成
 */
export function createBombPotGameState(playerChips: number = 600): GameState {
  return createBombPotBaseState(playerChips);
}

/**
 * Bomb pot ハンドを開始（全員アンテ徴収 → 4枚配布 → 2ボードにフロップ → 'flop' から進行）
 */
export function startBombPotHand(state: GameState): GameState {
  return startHandCore(state, bombPotDescriptor);
}

/**
 * Bomb pot 用の有効アクション（通常 PLO と同一の Pot Limit ロジック）
 */
export function getBombPotValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  return getValidActionsCore(state, playerIndex, bombPotDescriptor);
}

/**
 * Bomb pot のアクション適用
 */
export function applyBombPotAction(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  return applyActionCore(state, playerIndex, action, amount, bombPotDescriptor, rakePercent, rakeCapBB);
}

/**
 * 適用前にストリートが進むかを判定
 */
export function wouldBombPotAdvanceStreet(
  state: GameState,
  playerIndex: number,
  action: Action,
  amount: number = 0,
): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, bombPotDescriptor);
}

/**
 * 勝者決定（各 contested side pot を 2 ボードに半分割し、ボード毎に PLO 評価）
 */
export function determineBombPotWinner(
  state: GameState,
  rakePercent: number = 0,
  rakeCapBB: number = 0,
): GameState {
  return determineWinnerCore(state, bombPotDescriptor, rakePercent, rakeCapBB);
}
