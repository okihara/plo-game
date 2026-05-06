import { Card, HandRank } from './types';
import { getRankValue } from './deck';
import { formatPLOFlushName } from './handName';

// PLO/PLO5: 必ず2枚のホールカードと3枚のコミュニティカードを使う
// PLO  → ホール 4 枚 (C(4,2)=6 通り)
// PLO5 → ホール 5 枚 (C(5,2)=10 通り)
export function evaluatePLOHand(holeCards: Card[], communityCards: Card[]): HandRank {
  if ((holeCards.length !== 4 && holeCards.length !== 5) || (communityCards.length < 4 || communityCards.length > 5)) {
    throw new Error('PLO requires 4 or 5 hole cards and 4-5 community cards');
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

  // 表示用: PLO フラッシュは "Aフラッシュ"（ボード由来ハイカード）でなく
  // "Jフラッシュ"（ホール由来ハイカード）で表示する。判定 (highCards/compareHands) は不変。
  if (bestHand.rank === 6) {
    bestHand = { ...bestHand, name: formatPLOFlushName(holeCards, communityCards) };
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

// Hold'em: 2枚のホールカード + 5枚のコミュニティカードから最強の5枚を選ぶ（C(7,5)=21通り）
export function evaluateHoldemHand(holeCards: Card[], communityCards: Card[]): HandRank {
  if (holeCards.length !== 2 || communityCards.length !== 5) {
    throw new Error('Hold\'em requires 2 hole cards and 5 community cards');
  }

  const allCards = [...holeCards, ...communityCards];
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

// Hold'em: コミュニティカード3枚以上で現在のベストハンドを評価（フロップ・ターン対応）
export function evaluateCurrentHoldemHand(holeCards: Card[], communityCards: Card[]): HandRank | null {
  if (holeCards.length !== 2 || communityCards.length < 3) {
    return null;
  }

  const allCards = [...holeCards, ...communityCards];
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

// コミュニティカード3枚以上で現在のベストハンドを評価（フロップ・ターン対応）
// PLO は 4 枚、PLO5 は 5 枚のホールカードを受け取る
export function evaluateCurrentHand(holeCards: Card[], communityCards: Card[]): HandRank | null {
  if ((holeCards.length !== 4 && holeCards.length !== 5) || communityCards.length < 3) {
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

  // 表示用: PLO フラッシュはホール由来ハイカードで表示（evaluatePLOHand と同じ）
  if (bestHand.rank === 6) {
    bestHand = { ...bestHand, name: formatPLOFlushName(holeCards, communityCards) };
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

// =========================================================================
//  Razz (A-5 Lowball) Hand Evaluation
// =========================================================================

/** Razz用ランク値: Ace = 1（低い） */
function getRazzRankValue(rank: string): number {
  const map: Record<string, number> = {
    'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
    '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13,
  };
  return map[rank] ?? 0;
}

/**
 * Razz 5枚ハンド評価（A-5ロー）
 * - Ace = 1（最低）
 * - ストレート・フラッシュはカウントしない（ローに影響なし）
 * - ペアなしが最強、ペアありは弱い
 *
 * rank: 1=ノーペア（最強ロー）, 2=ワンペア, 3=ツーペア, 4=スリーカード,
 *       5=フルハウス, 6=フォーカード
 * highCards: カード値を降順（Ace=1）で格納。低いほど良い。
 */
function evaluateRazzFiveCardHand(cards: Card[]): HandRank {
  const values = cards.map(c => getRazzRankValue(c.rank)).sort((a, b) => b - a);
  const groups = getRazzGroups(values);

  // フォーカード
  if (groups[0].count === 4) {
    return { rank: 6, name: formatRazzName(values), highCards: [groups[0].value, groups[1].value] };
  }
  // フルハウス
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 5, name: formatRazzName(values), highCards: [groups[0].value, groups[1].value] };
  }
  // スリーカード
  if (groups[0].count === 3) {
    return { rank: 4, name: formatRazzName(values), highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }
  // ツーペア
  if (groups[0].count === 2 && groups[1].count === 2) {
    return { rank: 3, name: formatRazzName(values), highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }
  // ワンペア
  if (groups[0].count === 2) {
    return { rank: 2, name: formatRazzName(values), highCards: [groups[0].value, groups[1].value, groups[2].value, groups[3].value] };
  }
  // ノーペア（最強ロー）— highCards は降順（最高カードから）
  return { rank: 1, name: formatRazzName(values), highCards: values };
}

/** Razz用グループ化: ペアのカウント順、同カウントなら高い値が先（ペアは悪いので高い方が先） */
function getRazzGroups(values: number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const groups = Array.from(counts.entries()).map(([value, count]) => ({ value, count }));
  groups.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.value - a.value; // ペア同士なら高い方が先（悪い方）
  });
  return groups;
}

/** Razz ハンド名のフォーマット: "8-low", "Wheel" 等 */
function formatRazzName(values: number[]): string {
  const sorted = [...values].sort((a, b) => b - a);
  // ノーペアかチェック
  const unique = new Set(sorted);
  if (unique.size === sorted.length) {
    // Wheel: A-2-3-4-5
    if (sorted[0] === 5 && sorted[1] === 4 && sorted[2] === 3 && sorted[3] === 2 && sorted[4] === 1) {
      return 'Wheel';
    }
    const rankName = razzValueToDisplay(sorted[0]);
    return `${rankName}-low`;
  }
  // ペアあり
  const counts = new Map<number, number>();
  for (const v of sorted) counts.set(v, (counts.get(v) || 0) + 1);
  const maxCount = Math.max(...counts.values());
  if (maxCount >= 4) return 'フォーカード';
  if (maxCount === 3 && counts.size === 2) return 'フルハウス';
  if (maxCount === 3) return 'スリーカード';
  const pairs = [...counts.values()].filter(c => c === 2).length;
  if (pairs === 2) return 'ツーペア';
  return 'ワンペア';
}

function razzValueToDisplay(value: number): string {
  const map: Record<number, string> = {
    1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8',
    9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K',
  };
  return map[value] ?? String(value);
}

/**
 * Razz: 5〜7枚から最良のロー5枚を選択
 * C(7,5)=21通りの組み合わせから最も低いハンドを返す
 */
export function evaluateRazzHand(allCards: Card[]): HandRank {
  if (allCards.length < 5 || allCards.length > 7) {
    throw new Error(`Razz requires 5-7 cards, got ${allCards.length}`);
  }

  const combos = getCombinations(allCards, 5);
  let bestLow: HandRank | null = null;

  for (const combo of combos) {
    const hand = evaluateRazzFiveCardHand(combo);
    if (!bestLow || compareLowHands(hand, bestLow) < 0) {
      bestLow = hand;
    }
  }

  return bestLow!;
}

/**
 * ロー比較: 低い方が勝ち（負の値 = a が良い）
 * rank が小さい方が良い、同 rank なら highCards を左（最高カード）から比較し小さい方が良い
 */
export function compareLowHands(a: HandRank, b: HandRank): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  for (let i = 0; i < Math.min(a.highCards.length, b.highCards.length); i++) {
    if (a.highCards[i] !== b.highCards[i]) {
      return a.highCards[i] - b.highCards[i];
    }
  }

  return 0;
}

// =========================================================================
//  2-7 (Deuce-to-Seven) Lowball Hand Evaluation
// =========================================================================

/**
 * 2-7 ローボール 5枚ハンド評価
 * - Ace は常に 14（ハイ）
 * - ストレート・フラッシュはカウントする（悪い手になる）
 * - ペアなしノーストレートノーフラッシュが最強
 *
 * rank 体系（低い = 良い手）:
 *   1 = ハイカード（ベスト）
 *   2 = ワンペア, 3 = ツーペア, 4 = スリーカード,
 *   5 = ストレート, 6 = フラッシュ, 7 = フルハウス,
 *   8 = フォーカード, 9 = ストレートフラッシュ（ワースト）
 *
 * highCards: カード値を降順。低いほど良い。
 * ベストハンド: 2-3-4-5-7 (Number One)
 */
export function evaluate27LowHand(cards: Card[]): HandRank {
  if (cards.length !== 5) {
    throw new Error(`2-7 requires exactly 5 cards, got ${cards.length}`);
  }

  const sortedCards = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));
  const values = sortedCards.map(c => getRankValue(c.rank));
  const suits = sortedCards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = check27Straight(values);
  const groups = getGroups(values);

  // ストレートフラッシュ
  if (isFlush && isStraight) {
    const straightHigh = get27StraightHigh(values);
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
    const straightHigh = get27StraightHigh(values);
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

  // ハイカード（最強カテゴリ）
  const name = format27LowName(values);
  return { rank: 1, name, highCards: values };
}

/**
 * 2-7 ロー比較: 低い方が勝ち（負の値 = a が良い）
 * rank が小さい方が良い、同 rank なら highCards を左から比較し小さい方が良い
 */
export function compare27LowHands(a: HandRank, b: HandRank): number {
  if (a.rank !== b.rank) return a.rank - b.rank;

  for (let i = 0; i < Math.min(a.highCards.length, b.highCards.length); i++) {
    if (a.highCards[i] !== b.highCards[i]) {
      return a.highCards[i] - b.highCards[i];
    }
  }

  return 0;
}

/**
 * 2-7 ストレート判定: Ace は常に 14（ハイ）のみ。A-2-3-4-5 はストレートにならない。
 */
function check27Straight(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => b - a);
  for (let i = 0; i < 4; i++) {
    if (sorted[i] - sorted[i + 1] !== 1) {
      return false;
    }
  }
  return true;
}

/** 2-7 ストレートのハイカード */
function get27StraightHigh(values: number[]): number {
  return Math.max(...values);
}

/** 2-7 ハイカードのハンド名: "7-5 low", "Number One" 等 */
function format27LowName(values: number[]): string {
  const sorted = [...values].sort((a, b) => b - a);
  // Number One: 7-5-4-3-2
  if (sorted[0] === 7 && sorted[1] === 5 && sorted[2] === 4 && sorted[3] === 3 && sorted[4] === 2) {
    return 'Number One';
  }
  const display = (v: number) => {
    if (v === 14) return 'A';
    if (v === 13) return 'K';
    if (v === 12) return 'Q';
    if (v === 11) return 'J';
    if (v === 10) return 'T';
    return String(v);
  };
  return `${display(sorted[0])}-${display(sorted[1])} low`;
}

/**
 * Razz: アップカードのみでショウイングハンドのロー強度を評価（アクション順序決定用）
 * 低いハンドほど良い
 */
// =========================================================================
//  8-or-Better Low Hand Evaluation (for Hi-Lo variants)
// =========================================================================

/**
 * 8-or-better ロー5枚ハンド評価
 * - Razzと同じA-5ローボール（Ace=1、ストレート/フラッシュ無視）
 * - クオリファイ条件: 5枚すべて8以下 かつ 5ランクすべて異なる（ペア不可）
 * - クオリファイしない場合は null を返す
 */
function evaluate8OrBetterFiveCardLow(cards: Card[]): HandRank | null {
  const values = cards.map(c => getRazzRankValue(c.rank));
  if (!values.every(v => v <= 8)) return null;
  if (new Set(values).size !== 5) return null;  // ペアあり = ロー不成立
  return evaluateRazzFiveCardHand(cards);
}

/**
 * 8-or-better: 5〜7枚から最良のクオリファイングロー5枚を選択
 * クオリファイするハンドがない場合は null を返す
 */
export function evaluate8OrBetterLow(allCards: Card[]): HandRank | null {
  if (allCards.length < 5) return null;

  const combos = getCombinations(allCards, 5);
  let bestLow: HandRank | null = null;

  for (const combo of combos) {
    const hand = evaluate8OrBetterFiveCardLow(combo);
    if (hand && (!bestLow || compareLowHands(hand, bestLow) < 0)) {
      bestLow = hand;
    }
  }

  return bestLow;
}

/**
 * Omaha 8-or-better ロー評価: ホール 2 + コミュ 3 制約で最良のロー 5 枚を選ぶ。
 * クオリファイするハンドがない場合は null を返す。
 */
function evaluateOmaha8OrBetterLow(holeCards: Card[], communityCards: Card[]): HandRank | null {
  const holeCardCombos = getCombinations(holeCards, 2);
  const communityCombos = getCombinations(communityCards, 3);

  let bestLow: HandRank | null = null;
  for (const holeCombo of holeCardCombos) {
    for (const communityCombo of communityCombos) {
      const fiveCards = [...holeCombo, ...communityCombo];
      const lowHand = evaluate8OrBetterFiveCardLow(fiveCards);
      if (lowHand && (!bestLow || compareLowHands(lowHand, bestLow) < 0)) {
        bestLow = lowHand;
      }
    }
  }
  return bestLow;
}

/**
 * Omaha Hi-Lo: ハイとローの両方を評価
 * - ハイ: PLOと同じ（ホール2枚+コミュ3枚で最強ハイハンド）
 * - ロー: ホール2枚+コミュ3枚で最良の8-or-betterロー
 */
export function evaluateOmahaHiLoHand(
  holeCards: Card[],
  communityCards: Card[],
): { high: HandRank; low: HandRank | null } {
  if (holeCards.length !== 4 || communityCards.length !== 5) {
    throw new Error('Omaha Hi-Lo requires 4 hole cards and 5 community cards');
  }
  return {
    high: evaluatePLOHand(holeCards, communityCards),
    low: evaluateOmaha8OrBetterLow(holeCards, communityCards),
  };
}

/**
 * Omaha Hi-Lo: コミュニティカード3枚以上で現在のベストハンドを評価（フロップ・ターン対応）
 */
export function evaluateCurrentOmahaHiLoHand(
  holeCards: Card[],
  communityCards: Card[],
): { high: HandRank; low: HandRank | null } | null {
  if (holeCards.length !== 4 || communityCards.length < 3) {
    return null;
  }
  return {
    high: evaluateCurrentHand(holeCards, communityCards)!,
    low: evaluateOmaha8OrBetterLow(holeCards, communityCards),
  };
}

/**
 * Stud Hi-Lo: 5〜7枚からハイとローの両方を評価
 * - ハイ: evaluateStudHand と同じ
 * - ロー: 8-or-better
 */
export function evaluateStudHiLoHand(allCards: Card[]): { high: HandRank; low: HandRank | null } {
  if (allCards.length < 5 || allCards.length > 7) {
    throw new Error(`Stud Hi-Lo requires 5-7 cards, got ${allCards.length}`);
  }

  const high = evaluateStudHand(allCards);
  const low = evaluate8OrBetterLow(allCards);

  return { high, low };
}

export function evaluateRazzShowingHand(upCards: Card[]): HandRank {
  if (upCards.length === 0) {
    return { rank: 0, name: '', highCards: [] };
  }
  if (upCards.length >= 5) {
    return evaluateRazzFiveCardHand(upCards.slice(0, 5));
  }

  const values = upCards.map(c => getRazzRankValue(c.rank)).sort((a, b) => b - a);
  const groups = getRazzGroups(values);

  // フォーカード
  if (groups[0].count === 4) {
    return { rank: 6, name: 'フォーカード', highCards: [groups[0].value, ...groups.slice(1).map(g => g.value)] };
  }
  // スリーカード
  if (groups[0].count === 3) {
    return { rank: 4, name: 'スリーカード', highCards: [groups[0].value, ...groups.slice(1).map(g => g.value)] };
  }
  // ツーペア
  if (groups.length >= 2 && groups[0].count === 2 && groups[1].count === 2) {
    return { rank: 3, name: 'ツーペア', highCards: [groups[0].value, groups[1].value, ...groups.slice(2).map(g => g.value)] };
  }
  // ワンペア
  if (groups[0].count === 2) {
    return { rank: 2, name: 'ワンペア', highCards: [groups[0].value, ...groups.slice(1).map(g => g.value)] };
  }
  // ノーペア — 値を降順で返す（低い値ほど良い）
  return { rank: 1, name: 'ハイカード', highCards: values };
}
