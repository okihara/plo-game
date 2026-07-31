// エクスプロイターagent が共通で使う小道具。
// ベット額はすべて gameEngine の applyAction と同じ「このアクションで追加するチップ」で扱う。

import { GameState, Action } from '../../types.js';
import { getValidActions } from '../../gameEngine.js';
import { evaluateCurrentHand } from '../../handEvaluator.js';
import { evaluatePreFlopStrength } from '../../preflopEquity.js';
import { AgentDecision } from './types.js';

export interface ActionOption {
  action: Action;
  minAmount: number;
  maxAmount: number;
}

export function getOptions(state: GameState, playerIndex: number): ActionOption[] {
  return getValidActions(state, playerIndex);
}

export function pick(options: ActionOption[], ...actions: Action[]): ActionOption | undefined {
  for (const a of actions) {
    const found = options.find(o => o.action === a);
    if (found) return found;
  }
  return undefined;
}

export function toCallOf(state: GameState, playerIndex: number): number {
  return Math.max(0, state.currentBet - state.players[playerIndex].currentBet);
}

/** 現在のメイドハンドランク (1=ハイカード〜9=ストフラ)。プリフロップは 0 */
export function madeRankOf(state: GameState, playerIndex: number): number {
  if (state.communityCards.length < 3) return 0;
  const hand = evaluateCurrentHand(state.players[playerIndex].holeCards, state.communityCards);
  return hand?.rank ?? 0;
}

export function preflopStrengthOf(state: GameState, playerIndex: number): number {
  return evaluatePreFlopStrength(state.players[playerIndex].holeCards);
}

/** プリフロップのレイズ回数 (1=オープン, 2=3bet, 3=4bet...) */
export function preflopRaiseCount(state: GameState): number {
  return state.handHistory.filter(
    a => a.street === 'preflop' && (a.action === 'raise' || a.action === 'bet' || a.action === 'allin')
  ).length;
}

export function checkOrFold(options: ActionOption[]): AgentDecision {
  const check = pick(options, 'check');
  if (check) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

export function callOrFold(options: ActionOption[]): AgentDecision {
  const call = pick(options, 'call');
  if (call) return { action: 'call', amount: call.minAmount };
  return checkOrFold(options);
}

/**
 * ポット比 pct のベット/レイズ。pct=1.0 でポットベット（ポットリミット最大）。
 * bet/raise が選べない場合は null。
 */
export function betPct(
  state: GameState,
  playerIndex: number,
  options: ActionOption[],
  pct: number
): AgentDecision | null {
  const target = pick(options, 'bet', 'raise', 'allin');
  if (!target) return null;
  const toCall = toCallOf(state, playerIndex);
  const potAfterCall = state.pot + toCall;
  const add = Math.round(toCall + pct * potAfterCall);
  const amount = Math.max(target.minAmount, Math.min(target.maxAmount, add));
  return { action: target.action, amount };
}
