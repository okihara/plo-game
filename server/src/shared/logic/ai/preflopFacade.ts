// プリフロップハンド評価のファサード。
// variant に応じて PLO 用 (equity 表ベース) か 多枚数オマハ用 (PLO5/PLO6 ヒューリスティック) を選ぶ。
// 呼び出し元 (cpuAI / preflopStrategy) はこのファサードを経由することで variant 分岐を散らさない。

import { Card, GameVariant } from '../types.js';
import { getPreFlopEvaluation, evaluatePreFlopStrength, PreFlopEvaluation } from '../preflopEquity.js';
import { evaluatePreflopPLO5, evaluatePreflopStrengthPLO5 } from './preflopEvaluatorPLO5.js';

// 4 枚 equity 表が使えない多枚数オマハ (5〜6 枚)。
const MULTI_CARD_OMAHA: ReadonlySet<GameVariant> = new Set(['plo5', 'plo6', 'big_o']);

export function evaluatePreflopByVariant(holeCards: Card[], variant: GameVariant): PreFlopEvaluation {
  if (MULTI_CARD_OMAHA.has(variant)) return evaluatePreflopPLO5(holeCards);
  return getPreFlopEvaluation(holeCards);
}

export function evaluatePreflopStrengthByVariant(holeCards: Card[], variant: GameVariant): number {
  if (MULTI_CARD_OMAHA.has(variant)) return evaluatePreflopStrengthPLO5(holeCards);
  return evaluatePreFlopStrength(holeCards);
}
