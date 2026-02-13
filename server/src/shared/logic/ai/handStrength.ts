import { Card, Rank, Suit, Street } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluatePLOHand } from '../handEvaluator.js';
import { ExtendedHandEval, ExtendedBoardTexture } from './types.js';
import { estimateHandEquity } from './equityEstimator.js';
import { analyzeBlockers } from './blockerAnalysis.js';

/**
 * 拡張ハンド評価。
 * 既存のメイドハンド + ドロー評価に加え、エクイティ・ブロッカー・脆弱性を計算。
 */
export function evaluateHandExtended(
  holeCards: Card[],
  communityCards: Card[],
  street: Street,
  numOpponents: number,
  boardTexture?: ExtendedBoardTexture
): ExtendedHandEval {
  if (communityCards.length < 3) {
    return makeDefaultEval(holeCards);
  }

  // メイドハンド評価
  const evalCommunity = communityCards.length >= 5
    ? communityCards
    : padToFive(holeCards, communityCards);

  const madeHand = evaluatePLOHand(holeCards, evalCommunity);

  // ドロー評価
  const drawInfo = evaluateDraws(holeCards, communityCards);

  // ナッツ判定
  const isNuts = checkIfNuts(holeCards, communityCards, madeHand.rank);
  const isNearNuts = !isNuts && madeHand.rank >= 5 && madeHand.highCards[0] >= 12;

  // 総合強度（既存ロジック）
  let strength = madeHand.rank / 9;
  if (madeHand.highCards.length > 0) {
    strength += (madeHand.highCards[0] - 8) / 60;
  }
  if (communityCards.length < 5) {
    strength += drawInfo.drawStrength * 0.3;
  }
  strength = Math.min(1, strength);

  // エクイティ推定（新規）
  const estimatedEquity = estimateHandEquity(
    holeCards, communityCards, madeHand.rank, street, numOpponents
  );

  // ブロッカー分析（新規）
  const blockers = analyzeBlockers(holeCards, communityCards);

  // ドローに対する脆弱性（新規）
  const vulnerabilityToDraws = calculateVulnerability(
    madeHand.rank, communityCards, boardTexture
  );

  return {
    strength,
    madeHandRank: madeHand.rank,
    hasFlushDraw: drawInfo.hasFlushDraw,
    hasStraightDraw: drawInfo.hasStraightDraw,
    hasWrapDraw: drawInfo.hasWrapDraw,
    drawStrength: drawInfo.drawStrength,
    isNuts,
    isNearNuts,
    estimatedEquity,
    blockerScore: blockers.blockerScore,
    vulnerabilityToDraws,
  };
}

/**
 * ドロー評価。既存の evaluateDraws のロジックをここに移動。
 */
function evaluateDraws(holeCards: Card[], communityCards: Card[]): {
  hasFlushDraw: boolean;
  hasStraightDraw: boolean;
  hasWrapDraw: boolean;
  drawStrength: number;
} {
  const allCards = [...holeCards, ...communityCards];
  let drawStrength = 0;

  // フラッシュドロー判定（PLO: ホールから2枚使用必須）
  const suitCounts: Record<string, { hole: number; comm: number }> = {};
  for (const card of holeCards) {
    suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 };
    suitCounts[card.suit].hole++;
  }
  for (const card of communityCards) {
    suitCounts[card.suit] = suitCounts[card.suit] || { hole: 0, comm: 0 };
    suitCounts[card.suit].comm++;
  }

  let hasFlushDraw = false;
  for (const [suit, counts] of Object.entries(suitCounts)) {
    if (counts.hole >= 2 && counts.hole + counts.comm >= 4) {
      hasFlushDraw = true;
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      const hasAce = holeOfSuit.some(c => c.rank === 'A');
      drawStrength += hasAce ? 0.4 : 0.25;
      break;
    }
  }

  // ストレートドロー判定
  const values = [...new Set(allCards.map(c => getRankValue(c.rank)))].sort((a, b) => b - a);
  const holeValues = new Set(holeCards.map(c => getRankValue(c.rank)));

  let hasStraightDraw = false;
  let hasWrapDraw = false;

  for (let high = 14; high >= 5; high--) {
    let count = 0;
    let holeUsed = 0;

    for (let v = high; v > high - 5; v--) {
      const checkVal = v <= 0 ? v + 14 : v;
      if (values.includes(checkVal)) {
        count++;
        if (holeValues.has(checkVal)) holeUsed++;
      }
    }

    if (count >= 4 && holeUsed >= 2) {
      hasStraightDraw = true;
      const outs = countStraightOuts(values, holeValues);
      if (outs >= 8) {
        hasWrapDraw = true;
      }
    }
  }

  if (hasStraightDraw) {
    drawStrength += hasWrapDraw ? 0.35 : 0.2;
  }

  return {
    hasFlushDraw,
    hasStraightDraw,
    hasWrapDraw,
    drawStrength: Math.min(1, drawStrength),
  };
}

/**
 * ストレートアウツを数える。
 */
function countStraightOuts(allValues: number[], holeValues: Set<number>): number {
  let outs = 0;
  const valuesSet = new Set(allValues);

  for (let card = 2; card <= 14; card++) {
    if (valuesSet.has(card)) continue;

    const testValues = [...allValues, card].sort((a, b) => b - a);
    for (let i = 0; i <= testValues.length - 5; i++) {
      let isConsecutive = true;
      let holeUsed = 0;
      for (let j = 0; j < 5; j++) {
        if (j > 0 && testValues[i + j - 1] - testValues[i + j] !== 1) {
          isConsecutive = false;
          break;
        }
        if (holeValues.has(testValues[i + j])) holeUsed++;
      }
      if (isConsecutive && holeUsed >= 2) {
        outs++;
        break;
      }
    }
  }

  return outs;
}

/**
 * ドローに対する脆弱性を計算 (0-1)。
 * メイドハンドが弱く、ボードがウェットなほど脆弱。
 */
function calculateVulnerability(
  madeHandRank: number,
  communityCards: Card[],
  boardTexture?: ExtendedBoardTexture
): number {
  // リバーではドローに負ける心配なし（もう変化しない）
  if (communityCards.length >= 5) return 0;

  let vulnerability = 0;

  // メイドハンドが弱いほど脆弱
  if (madeHandRank <= 2) vulnerability += 0.4;       // ワンペア以下
  else if (madeHandRank === 3) vulnerability += 0.25; // ツーペア
  else if (madeHandRank === 4) vulnerability += 0.15; // セット
  else if (madeHandRank === 5) vulnerability += 0.10; // ストレート

  // ボードテクスチャによる脆弱性
  if (boardTexture) {
    if (boardTexture.flushDraw || boardTexture.flushPossible) vulnerability += 0.2;
    if (boardTexture.isConnected) vulnerability += 0.15;
    if (boardTexture.dynamism > 0.5) vulnerability += 0.1;
  }

  return Math.min(1, vulnerability);
}

/**
 * ナッツ判定（簡易版）。
 */
function checkIfNuts(holeCards: Card[], communityCards: Card[], handRank: number): boolean {
  if (handRank === 9) return true; // ストレートフラッシュ
  if (handRank === 8) return true; // フォーカード

  // フルハウスでトップセット
  if (handRank === 7) {
    const boardValues = communityCards.map(c => getRankValue(c.rank));
    const holeValues = holeCards.map(c => getRankValue(c.rank));
    const maxBoard = Math.max(...boardValues);
    if (holeValues.filter(v => v === maxBoard).length >= 2) return true;
  }

  // ナッツフラッシュ
  if (handRank === 6) {
    for (const suit of ['h', 'd', 'c', 's'] as const) {
      const holeOfSuit = holeCards.filter(c => c.suit === suit);
      const boardOfSuit = communityCards.filter(c => c.suit === suit);
      if (holeOfSuit.length >= 2 && boardOfSuit.length >= 3) {
        if (holeOfSuit.some(c => c.rank === 'A')) return true;
      }
    }
  }

  return false;
}

/**
 * コミュニティカードが5枚に足りない場合ダミーで補完（評価用）。
 */
function padToFive(holeCards: Card[], communityCards: Card[]): Card[] {
  if (communityCards.length >= 5) return communityCards;

  const used = new Set([
    ...holeCards.map(c => `${c.rank}${c.suit}`),
    ...communityCards.map(c => `${c.rank}${c.suit}`),
  ]);
  const result = [...communityCards];
  const ranks: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const suits: Suit[] = ['h', 'd', 'c', 's'];

  for (const rank of ranks) {
    for (const suit of suits) {
      if (!used.has(`${rank}${suit}`) && result.length < 5) {
        result.push({ rank, suit });
      }
      if (result.length >= 5) break;
    }
    if (result.length >= 5) break;
  }
  return result;
}

/**
 * デフォルトの ExtendedHandEval（プリフロップやコミュニティが3枚未満の場合）。
 */
function makeDefaultEval(holeCards: Card[]): ExtendedHandEval {
  return {
    strength: 0,
    madeHandRank: 0,
    hasFlushDraw: false,
    hasStraightDraw: false,
    hasWrapDraw: false,
    drawStrength: 0,
    isNuts: false,
    isNearNuts: false,
    estimatedEquity: 0,
    blockerScore: 0,
    vulnerabilityToDraws: 0,
  };
}
