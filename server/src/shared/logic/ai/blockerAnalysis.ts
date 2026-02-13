import { Card, Suit } from '../types.js';
import { getRankValue } from '../deck.js';
import { BlockerAnalysis } from './types.js';

/**
 * ブロッカー分析。
 * PLOでは相手のナッツハンドをブロックしているかが非常に重要。
 * ブラフ候補の選定やバリューベットの判断に使う。
 */
export function analyzeBlockers(
  holeCards: Card[],
  communityCards: Card[]
): BlockerAnalysis {
  let blockerScore = 0;

  const blocksNutFlush = checkBlocksNutFlush(holeCards, communityCards);
  const blocksNutStraight = checkBlocksNutStraight(holeCards, communityCards);
  const blocksTopSet = checkBlocksTopSet(holeCards, communityCards);

  if (blocksNutFlush) blockerScore += 0.35;
  if (blocksNutStraight) blockerScore += 0.25;
  if (blocksTopSet) blockerScore += 0.20;

  // ボードのトップ2カードを1枚以上持っている場合もブロッカー価値あり
  if (blocksSecondPair(holeCards, communityCards)) {
    blockerScore += 0.10;
  }

  return {
    blocksNutFlush,
    blocksNutStraight,
    blocksTopSet,
    blockerScore: Math.min(1, blockerScore),
  };
}

/**
 * ナッツフラッシュをブロックしているか。
 * フラッシュ完成可能なボード（同スート3枚以上）で、
 * そのスートのAをホールに持っている場合。
 */
function checkBlocksNutFlush(holeCards: Card[], communityCards: Card[]): boolean {
  const boardSuitCounts = new Map<string, number>();
  for (const c of communityCards) {
    boardSuitCounts.set(c.suit, (boardSuitCounts.get(c.suit) || 0) + 1);
  }

  for (const [suit, count] of boardSuitCounts) {
    if (count >= 3) {
      // フラッシュ可能ボード → 自分がそのスートのAを持っているか
      if (holeCards.some(c => c.suit === suit && c.rank === 'A')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * ナッツストレートをブロックしているか。
 * ストレート完成可能なボードで、ナッツストレートに必要なキーカードを持っている。
 */
function checkBlocksNutStraight(holeCards: Card[], communityCards: Card[]): boolean {
  const boardValues = communityCards.map(c => getRankValue(c.rank)).sort((a, b) => a - b);
  const holeValues = new Set(holeCards.map(c => getRankValue(c.rank)));

  if (boardValues.length < 3) return false;

  // ボードの最高値を含むストレートに必要なカードを計算
  const maxBoard = boardValues[boardValues.length - 1];

  // ナッツストレートはボード最高値+1、+2 あたりのカードが必要
  // 例: ボード 7-8-9 → ナッツストレートは T-J (11) が必要
  const nutCards = [maxBoard + 1, maxBoard + 2];
  for (const nutCard of nutCards) {
    if (nutCard <= 14 && holeValues.has(nutCard)) {
      return true;
    }
  }

  return false;
}

/**
 * トップセットをブロックしているか。
 * ボードの最高ランクのカードを1枚以上ホールに持っている。
 */
function checkBlocksTopSet(holeCards: Card[], communityCards: Card[]): boolean {
  if (communityCards.length === 0) return false;

  const boardValues = communityCards.map(c => getRankValue(c.rank));
  const maxBoardValue = Math.max(...boardValues);
  const holeValues = holeCards.map(c => getRankValue(c.rank));

  // ボードトップのランクを1枚持っている（2枚持っていたらセットなのでブロッカーではない）
  const matchCount = holeValues.filter(v => v === maxBoardValue).length;
  return matchCount === 1;
}

/**
 * セカンドペア（2番目に高いボードカード）をブロックしているか。
 */
function blocksSecondPair(holeCards: Card[], communityCards: Card[]): boolean {
  if (communityCards.length < 2) return false;

  const boardValues = [...new Set(communityCards.map(c => getRankValue(c.rank)))].sort((a, b) => b - a);
  if (boardValues.length < 2) return false;

  const secondValue = boardValues[1];
  const holeValues = holeCards.map(c => getRankValue(c.rank));

  return holeValues.filter(v => v === secondValue).length === 1;
}

/**
 * ブラフ候補としてのブロッカー価値 (0-1)。
 * ブロッカーが強いほど、相手の強いハンドをブロックしているのでブラフに適している。
 */
export function bluffBlockerValue(
  holeCards: Card[],
  communityCards: Card[]
): number {
  const analysis = analyzeBlockers(holeCards, communityCards);

  let value = 0;

  // ナッツフラッシュブロッカーはブラフに最適
  if (analysis.blocksNutFlush) value += 0.4;
  // ナッツストレートブロッカーも有用
  if (analysis.blocksNutStraight) value += 0.3;
  // トップセットブロッカーは中程度
  if (analysis.blocksTopSet) value += 0.2;

  return Math.min(1, value);
}
