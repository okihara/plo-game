import { Card } from '../types.js';
import { getRankValue } from '../deck.js';
import { ExtendedBoardTexture } from './types.js';

/**
 * ボードテクスチャの拡張分析。
 * 既存の analyzeBoardTexture の全機能を含み、追加の分析を行う。
 */
export function analyzeBoard(communityCards: Card[]): ExtendedBoardTexture {
  const values = communityCards.map(c => getRankValue(c.rank));
  const suits = communityCards.map(c => c.suit);

  // === ペアボード判定 ===
  const valueCounts = new Map<number, number>();
  for (const v of values) {
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }
  const maxCount = Math.max(...valueCounts.values(), 0);
  const isPaired = maxCount >= 2;
  const isTrips = maxCount >= 3;

  // === スート分析 ===
  const suitCounts = new Map<string, number>();
  for (const s of suits) {
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  const maxSuitCount = Math.max(...suitCounts.values(), 0);
  const suitCountValues = Array.from(suitCounts.values());

  const flushPossible = maxSuitCount >= 3;
  const flushDraw = maxSuitCount === 2;
  const monotone = maxSuitCount >= 3;
  const rainbow = communityCards.length >= 3 && suitCountValues.every(c => c === 1);
  // twoTone: 2枚同スートがあるが3枚同スートはない
  const twoTone = !monotone && suitCountValues.some(c => c === 2);

  // === ストレート/コネクティビティ分析 ===
  const uniqueValues = [...new Set(values)].sort((a, b) => a - b);
  let isConnected = false;
  let straightPossible = false;

  if (uniqueValues.length >= 3) {
    let maxConsecutive = 1;
    let currentConsecutive = 1;
    for (let i = 1; i < uniqueValues.length; i++) {
      if (uniqueValues[i] - uniqueValues[i - 1] <= 2) {
        currentConsecutive++;
        maxConsecutive = Math.max(maxConsecutive, currentConsecutive);
      } else {
        currentConsecutive = 1;
      }
    }
    isConnected = maxConsecutive >= 3;
    straightPossible = isConnected;
  }

  // === ウェットボード判定 ===
  const isWet = (flushDraw || flushPossible) || isConnected;

  // === ハイカード・ブロードウェイ ===
  const highCard = Math.max(...values, 0);
  const averageRank = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  // ブロードウェイ: T(10), J(11), Q(12), K(13), A(14) が2枚以上
  const broadwayCount = values.filter(v => v >= 10).length;
  const hasBroadway = broadwayCount >= 2;

  // === ダイナミズム: 次カードでナッツが変わりやすさ ===
  const dynamism = calculateDynamism(communityCards, uniqueValues, suitCounts, isPaired);

  return {
    isPaired,
    isTrips,
    flushPossible,
    flushDraw,
    straightPossible,
    isConnected,
    isWet,
    highCard,
    monotone,
    twoTone,
    rainbow,
    dynamism,
    averageRank,
    hasBroadway,
  };
}

/**
 * ボードのダイナミズムを計算 (0-1)。
 * 次のカードでナッツが変わりやすいほど高い。
 */
function calculateDynamism(
  communityCards: Card[],
  uniqueValues: number[],
  suitCounts: Map<string, number>,
  isPaired: boolean
): number {
  if (communityCards.length >= 5) return 0; // リバー以降は変化なし

  let dynamism = 0;

  // フラッシュドロー可能（2枚同スート）→ 次にフラッシュ完成の可能性
  for (const count of suitCounts.values()) {
    if (count === 2) dynamism += 0.25;
    if (count === 3 && communityCards.length === 3) dynamism += 0.15; // 4枚目のフラッシュカード
  }

  // ストレートが近い: 連続した値が多い
  if (uniqueValues.length >= 2) {
    let closeCards = 0;
    for (let i = 0; i < uniqueValues.length - 1; i++) {
      const gap = uniqueValues[i + 1] - uniqueValues[i];
      if (gap <= 2) closeCards++;
    }
    dynamism += (closeCards / Math.max(uniqueValues.length - 1, 1)) * 0.25;
  }

  // ペアでないボードは次にペアになる可能性
  if (!isPaired) dynamism += 0.1;

  // ローボードは変化しやすい（ハイカードが落ちやすい）
  const avgRank = uniqueValues.reduce((a, b) => a + b, 0) / Math.max(uniqueValues.length, 1);
  if (avgRank < 9) dynamism += 0.1;

  return Math.min(1, dynamism);
}

/**
 * ボードが「怖い」度合い（0-1）。
 * ドローが多い、もしくはナッツ級が存在しやすいボード。
 */
export function boardScaryness(boardTexture: ExtendedBoardTexture): number {
  let scary = 0;

  if (boardTexture.flushPossible) scary += 0.3;
  if (boardTexture.monotone) scary += 0.15;
  if (boardTexture.straightPossible) scary += 0.2;
  if (boardTexture.isPaired) scary += 0.15;
  if (boardTexture.isConnected) scary += 0.1;
  if (boardTexture.isWet) scary += 0.1;

  return Math.min(1, scary);
}
