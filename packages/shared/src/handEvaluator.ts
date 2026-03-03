import { Card, HandRank } from './types';
import { getRankValue } from './deck';

// PLOでは必ず2枚のホールカードと3枚のコミュニティカードを使う
export function evaluatePLOHand(holeCards: Card[], communityCards: Card[]): HandRank {
  if (holeCards.length !== 4 || communityCards.length !== 5) {
    throw new Error('PLO requires 4 hole cards and 5 community cards');
  }

  let bestHand: HandRank = { rank: 0, name: '', highCards: [] };

  // ホールカードから2枚を選ぶ組み合わせ (6通り)
  const holeCardCombos = getCombinations(holeCards, 2);

  // コミュニティカードから3枚を選ぶ組み合わせ (10通り)
  const communityCombos = getCombinations(communityCards, 3);

  for (const holeCombo of holeCardCombos) {
    for (const communityCombo of communityCombos) {
      const fiveCards = [...holeCombo, ...communityCombo];
      const handRank = evaluateFiveCardHand(fiveCards);
      if (compareHands(handRank, bestHand) > 0) {
        bestHand = handRank;
      }
    }
  }

  return bestHand;
}

function getCombinations<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];

  function combine(start: number, combo: T[]) {
    if (combo.length === size) {
      result.push([...combo]);
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }

  combine(0, []);
  return result;
}

function evaluateFiveCardHand(cards: Card[]): HandRank {
  const sortedCards = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));
  const values = sortedCards.map(c => getRankValue(c.rank));
  const suits = sortedCards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(values);
  const groups = getGroups(values);

  // ストレートフラッシュ
  if (isFlush && isStraight) {
    const straightHigh = getStraightHigh(values);
    return { rank: 9, name: 'ストレートフラッシュ', highCards: [straightHigh] };
  }

  // フォーカード
  if (groups[0].count === 4) {
    return { rank: 8, name: 'フォーカード', highCards: [groups[0].value, groups[1].value] };
  }

  // フルハウス
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 7, name: 'フルハウス', highCards: [groups[0].value, groups[1].value] };
  }

  // フラッシュ
  if (isFlush) {
    return { rank: 6, name: 'フラッシュ', highCards: values };
  }

  // ストレート
  if (isStraight) {
    const straightHigh = getStraightHigh(values);
    return { rank: 5, name: 'ストレート', highCards: [straightHigh] };
  }

  // スリーカード
  if (groups[0].count === 3) {
    return { rank: 4, name: 'スリーカード', highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }

  // ツーペア
  if (groups[0].count === 2 && groups[1].count === 2) {
    return { rank: 3, name: 'ツーペア', highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }

  // ワンペア
  if (groups[0].count === 2) {
    return { rank: 2, name: 'ワンペア', highCards: [groups[0].value, groups[1].value, groups[2].value, groups[3].value] };
  }

  // ハイカード
  return { rank: 1, name: 'ハイカード', highCards: values };
}

function checkStraight(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => b - a);

  // 通常のストレート
  let isNormalStraight = true;
  for (let i = 0; i < 4; i++) {
    if (sorted[i] - sorted[i + 1] !== 1) {
      isNormalStraight = false;
      break;
    }
  }
  if (isNormalStraight) return true;

  // A-2-3-4-5 (ホイール)
  const wheel = [14, 5, 4, 3, 2];
  if (sorted.every((v, i) => v === wheel[i])) {
    return true;
  }

  return false;
}

function getStraightHigh(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);

  // A-2-3-4-5の場合は5がハイ
  const wheel = [14, 5, 4, 3, 2];
  if (sorted.every((v, i) => v === wheel[i])) {
    return 5;
  }

  return sorted[0];
}

function getGroups(values: number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  const groups = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });

  return groups;
}

// コミュニティカード3枚以上で現在のベストハンドを評価（フロップ・ターン対応）
export function evaluateCurrentHand(holeCards: Card[], communityCards: Card[]): HandRank | null {
  if (holeCards.length !== 4 || communityCards.length < 3) {
    return null;
  }

  let bestHand: HandRank = { rank: 0, name: '', highCards: [] };
  const holeCardCombos = getCombinations(holeCards, 2);
  const communityCombos = getCombinations(communityCards, 3);

  for (const holeCombo of holeCardCombos) {
    for (const communityCombo of communityCombos) {
      const fiveCards = [...holeCombo, ...communityCombo];
      const handRank = evaluateFiveCardHand(fiveCards);
      if (compareHands(handRank, bestHand) > 0) {
        bestHand = handRank;
      }
    }
  }

  return bestHand;
}

// 7-Card Stud: 7枚から最強の5枚を選ぶ（C(7,5)=21通り）
export function evaluateStudHand(allCards: Card[]): HandRank {
  if (allCards.length < 5 || allCards.length > 7) {
    throw new Error(`Stud requires 5-7 cards, got ${allCards.length}`);
  }

  const combos = getCombinations(allCards, 5);
  let bestHand: HandRank = { rank: 0, name: '', highCards: [] };

  for (const combo of combos) {
    const handRank = evaluateFiveCardHand(combo);
    if (compareHands(handRank, bestHand) > 0) {
      bestHand = handRank;
    }
  }

  return bestHand;
}

// Stud: アップカードのみでショウイングハンドの強さを評価（アクション順序決定用）
// 1〜4枚のカードからペア/トリップスなどを判定し、HandRank互換で返す
export function evaluateShowingHand(upCards: Card[]): HandRank {
  if (upCards.length === 0) {
    return { rank: 0, name: '', highCards: [] };
  }
  if (upCards.length === 5) {
    return evaluateFiveCardHand(upCards);
  }

  const values = upCards.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
  const groups = getShowingGroups(values);

  // フォーカード
  if (groups[0].count === 4) {
    return { rank: 8, name: 'フォーカード', highCards: [groups[0].value, ...groups.slice(1).map(g => g.value)] };
  }
  // スリーカード
  if (groups[0].count === 3) {
    const kickers = groups.slice(1).map(g => g.value);
    return { rank: 4, name: 'スリーカード', highCards: [groups[0].value, ...kickers] };
  }
  // ツーペア
  if (groups.length >= 2 && groups[0].count === 2 && groups[1].count === 2) {
    const kickers = groups.slice(2).map(g => g.value);
    return { rank: 3, name: 'ツーペア', highCards: [groups[0].value, groups[1].value, ...kickers] };
  }
  // ワンペア
  if (groups[0].count === 2) {
    const kickers = groups.slice(1).map(g => g.value);
    return { rank: 2, name: 'ワンペア', highCards: [groups[0].value, ...kickers] };
  }
  // ハイカード
  return { rank: 1, name: 'ハイカード', highCards: values };
}

function getShowingGroups(values: number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const groups = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value;
  });
  return groups;
}

export function compareHands(a: HandRank, b: HandRank): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  for (let i = 0; i < Math.min(a.highCards.length, b.highCards.length); i++) {
    if (a.highCards[i] !== b.highCards[i]) {
      return a.highCards[i] - b.highCards[i];
    }
  }

  return 0;
}
