/**
 * Equity-backed pre-flop hand evaluator.
 * Uses Monte Carlo simulation results (16,432 canonical hands × 10K iterations)
 * to provide accurate pre-flop hand strength instead of heuristic scoring.
 *
 * Same interface as the original getPreFlopEvaluation.
 */

import { Card, Rank } from './types';
import { getRankValue } from './deck';
import equityData from './data/preflopEquity.json';

// Type for the equity lookup table: key -> equity percentage
const equityMap = equityData as Record<string, number>;

// Pre-compute min/max equity for normalization to 0-1 score
let minEq = Infinity;
let maxEq = -Infinity;
for (const key in equityMap) {
  const eq = equityMap[key];
  if (eq < minEq) minEq = eq;
  if (eq > maxEq) maxEq = eq;
}
const eqRange = maxEq - minEq;

// 24 suit permutations (precomputed)
const SUIT_PERMS: number[][] = [];
function genPerms(arr: number[], l: number): void {
  if (l === arr.length) { SUIT_PERMS.push([...arr]); return; }
  for (let i = l; i < arr.length; i++) {
    [arr[l], arr[i]] = [arr[i], arr[l]];
    genPerms(arr, l + 1);
    [arr[l], arr[i]] = [arr[i], arr[l]];
  }
}
genPerms([0, 1, 2, 3], 0);

const SUIT_TO_IDX: Record<string, number> = { h: 0, d: 1, c: 2, s: 3 };

/**
 * Compute the canonical key for a 4-card hand.
 * Tries all 24 suit permutations, picks lexicographically smallest.
 */
function canonicalKey(cards: Card[]): string {
  const rv = cards.map(c => getRankValue(c.rank));
  const si = cards.map(c => SUIT_TO_IDX[c.suit]);

  let bestKey: string | null = null;

  for (const perm of SUIT_PERMS) {
    const mapped: { r: number; s: number }[] = [];
    for (let i = 0; i < 4; i++) {
      mapped.push({ r: rv[i], s: perm[si[i]] });
    }
    mapped.sort((a, b) => a.r !== b.r ? b.r - a.r : a.s - b.s);

    let key = '';
    for (let i = 0; i < 4; i++) {
      if (i > 0) key += '-';
      key += mapped[i].r + '.' + mapped[i].s;
    }

    if (bestKey === null || key < bestKey) {
      bestKey = key;
    }
  }

  return bestKey!;
}

// --- PreFlopEvaluation interface (same as original) ---

export interface PreFlopEvaluation {
  score: number;           // 0-1 (equity-based)
  hasPair: boolean;
  pairRank: string | null;
  hasAceSuited: boolean;
  isDoubleSuited: boolean;
  isSingleSuited: boolean;
  isRundown: boolean;
  hasWrap: boolean;
  hasDangler: boolean;
}

const EMPTY_RESULT: PreFlopEvaluation = {
  score: 0, hasPair: false, pairRank: null, hasAceSuited: false,
  isDoubleSuited: false, isSingleSuited: false, isRundown: false,
  hasWrap: false, hasDangler: false,
};

/**
 * Equity-backed pre-flop evaluation.
 * Drop-in replacement for the heuristic getPreFlopEvaluation.
 */
export function getPreFlopEvaluation(holeCards: Card[]): PreFlopEvaluation {
  const validCards = holeCards.filter(c => c && c.rank && c.suit);
  if (validCards.length < 4) {
    return { ...EMPTY_RESULT };
  }

  // Lookup equity
  const key = canonicalKey(validCards);
  const equity = equityMap[key];
  if (equity === undefined) {
    return { ...EMPTY_RESULT };
  }

  const rawScore = (equity - minEq) / eqRange;

  // Structural flags (same logic as original)
  const values = validCards.map(c => getRankValue(c.rank));
  const suits = validCards.map(c => c.suit);
  const ranks = validCards.map(c => c.rank);

  const rankCounts = new Map<Rank, number>();
  const suitCounts = new Map<string, number>();
  for (let i = 0; i < 4; i++) {
    rankCounts.set(ranks[i], (rankCounts.get(ranks[i]) || 0) + 1);
    suitCounts.set(suits[i], (suitCounts.get(suits[i]) || 0) + 1);
  }

  const suitCountValues = Array.from(suitCounts.values());
  const isDoubleSuited = suitCountValues.filter(c => c === 2).length === 2;
  const isSingleSuited = !isDoubleSuited && suitCountValues.some(c => c === 2);

  // Pair
  const pairRanks = Array.from(rankCounts.entries()).filter(([, count]) => count >= 2);
  let pairRank: string | null = null;
  for (const [rank] of pairRanks) {
    const pairValue = getRankValue(rank);
    if (!pairRank || pairValue > getRankValue(pairRank[0] as Rank)) {
      pairRank = rank + rank;
    }
  }

  // Ace suited
  let hasAceSuited = false;
  if (ranks.includes('A')) {
    const suitToCards = new Map<string, Rank[]>();
    for (let i = 0; i < 4; i++) {
      if (!suitToCards.has(suits[i])) suitToCards.set(suits[i], []);
      suitToCards.get(suits[i])!.push(ranks[i]);
    }
    for (const [, cardRanks] of suitToCards) {
      if (cardRanks.includes('A') && cardRanks.length >= 2) {
        hasAceSuited = true;
        break;
      }
    }
  }

  // Rundown, wrap, dangler
  const uniqueValues = [...new Set(values)].sort((a, b) => a - b);
  const span = uniqueValues.length > 1 ? uniqueValues[uniqueValues.length - 1] - uniqueValues[0] : 0;
  const isRundown = uniqueValues.length === 4 && span === 3;
  const hasWrap = span <= 4 && uniqueValues.length >= 3;

  let hasDangler = false;
  if (uniqueValues.length >= 3) {
    const gaps: number[] = [];
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      gaps.push(uniqueValues[i + 1] - uniqueValues[i]);
    }
    const maxGap = Math.max(...gaps);
    const maxGapIdx = gaps.indexOf(maxGap);
    if (maxGap >= 5 && (maxGapIdx === 0 || maxGapIdx === uniqueValues.length - 2)) {
      hasDangler = true;
    } else if (maxGap >= 4) {
      hasDangler = true;
    }
  }

  const tripleOrMoreSuited = suitCountValues.some(c => c >= 3);
  const isRainbow = suitCountValues.every(c => c === 1);

  // === プレイアビリティ補正 ===
  // オールインエクイティはリバーまで見た勝率であり、
  // 実戦ではフロップ以降のドロー力・ナッツ力が
  // エクイティ実現率に大きく影響する。
  let playability = 0;

  // スーテッドネス: フラッシュドローでポストフロップのエクイティを実現しやすい
  if (isDoubleSuited) playability += 0.04;
  else if (isSingleSuited) playability += 0.02;
  if (tripleOrMoreSuited) playability -= 0.03; // 同スート3枚はフラッシュアウツ減少
  if (isRainbow) playability -= 0.02;

  // コネクティビティ: ストレートドロー・ラップで多くのボードに絡める
  if (isRundown && !hasDangler) playability += 0.03;
  else if (hasWrap) playability += 0.01;
  if (hasDangler) playability -= 0.04; // 1枚が孤立、ポストフロップで機能しない

  // ナットフラッシュドロー: Aスーテッドはドロー時にナッツ保証
  if (hasAceSuited) playability += 0.02;

  // ペア + バックアップなし: セット以外のポストフロップが弱い
  if (pairRanks.length > 0 && isRainbow && !hasWrap && !isRundown) {
    playability -= 0.03;
  }

  const score = Math.min(1, Math.max(0, rawScore + playability));

  return {
    score,
    hasPair: pairRanks.length > 0,
    pairRank,
    hasAceSuited,
    isDoubleSuited,
    isSingleSuited,
    isRundown,
    hasWrap,
    hasDangler,
  };
}

export function evaluatePreFlopStrength(holeCards: Card[]): number {
  return getPreFlopEvaluation(holeCards).score;
}
