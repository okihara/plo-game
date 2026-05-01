// プリフロップハンド評価のファサード。
// variant に応じて PLO 用 (equity 表ベース) か PLO5 用 (ヒューリスティック) を選ぶ。
// 呼び出し元 (cpuAI / preflopStrategy) はこのファサードを経由することで variant 分岐を散らさない。

import { Card, GameVariant } from '../types.js';
import { getPreFlopEvaluation, evaluatePreFlopStrength, PreFlopEvaluation } from '../preflopEquity.js';
import { evaluatePreflopPLO5, evaluatePreflopStrengthPLO5 } from './preflopEvaluatorPLO5.js';

export function evaluatePreflopByVariant(holeCards: Card[], variant: GameVariant): PreFlopEvaluation {
  if (variant === 'plo5') return evaluatePreflopPLO5(holeCards);
  return getPreFlopEvaluation(holeCards);
}

export function evaluatePreflopStrengthByVariant(holeCards: Card[], variant: GameVariant): number {
  if (variant === 'plo5') return evaluatePreflopStrengthPLO5(holeCards);
  return evaluatePreFlopStrength(holeCards);
}
