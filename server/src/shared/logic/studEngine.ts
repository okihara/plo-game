// Stud 系（7 Card Stud / Razz / Stud Hi-Lo）エンジン
// アンテ + ブリングイン、Fixed Limit。バリアント差分は StudVariantRules に委譲。
//
// 実装は engine/ の共通コア + 記述子（engine/variants/stud.ts）に移行済み。

import { GameState, Action, GameVariant } from './types.js';
import {
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineWinnerCore,
} from './engine/core.js';
import { StudVariantRules } from './studVariantRules.js';
import { StudHighRules } from './rules/studHighRules.js';
import { studDescriptorFor, createStudBaseState } from './engine/variants/stud.js';

/** デフォルトルール（後方互換） */
const DEFAULT_RULES = new StudHighRules();

export function createStudGameState(playerChips: number, ante: number, smallBet: number, variant: GameVariant = 'stud'): GameState {
  return createStudBaseState(playerChips, ante, smallBet, variant);
}

export function startStudHand(state: GameState, rules: StudVariantRules = DEFAULT_RULES): GameState {
  return startHandCore(state, studDescriptorFor(rules));
}

export function getStudValidActions(state: GameState, playerIndex: number): { action: Action; minAmount: number; maxAmount: number }[] {
  // 有効アクション判定はブリングイン規則を含めてルール非依存
  return getValidActionsCore(state, playerIndex, studDescriptorFor(DEFAULT_RULES));
}

export function applyStudAction(
  state: GameState, playerIndex: number, action: Action, amount: number = 0,
  rakePercent: number = 0, rakeCapBB: number = 0, rules: StudVariantRules = DEFAULT_RULES
): GameState {
  return applyActionCore(state, playerIndex, action, amount, studDescriptorFor(rules), rakePercent, rakeCapBB);
}

export function wouldStudAdvanceStreet(state: GameState, playerIndex: number, action: Action, amount: number = 0, rules: StudVariantRules = DEFAULT_RULES): boolean {
  return wouldAdvanceStreetCore(state, playerIndex, action, amount, studDescriptorFor(rules));
}

export function determineStudWinner(state: GameState, rakePercent: number = 0, rakeCapBB: number = 0, rules: StudVariantRules = DEFAULT_RULES): GameState {
  return determineWinnerCore(state, studDescriptorFor(rules), rakePercent, rakeCapBB);
}
