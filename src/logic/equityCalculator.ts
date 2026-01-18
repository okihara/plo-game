import { Card, Suit } from './types';
import { evaluatePLOHand, compareHands } from './handEvaluator';
import { getRankValue } from './deck';

// 残りのデッキからカードを取得
function getRemainingDeck(usedCards: Card[]): Card[] {
  const suits: Suit[] = ['h', 'd', 'c', 's'];
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
  const allCards: Card[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      allCards.push({ rank, suit });
    }
  }

  const usedSet = new Set(usedCards.map(c => `${c.rank}${c.suit}`));
  return allCards.filter(c => !usedSet.has(`${c.rank}${c.suit}`));
}

// 組み合わせを生成
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

// ナッツハンドを計算（現在のボード+任意のホールカード2枚で作れる最強ハンド）
function calculateNuts(communityCards: Card[], remainingDeck: Card[]): { rank: number; highCards: number[] } {
  let bestHand = { rank: 0, name: '', highCards: [] as number[] };

  // 残りのカードから任意の4枚を選び、その中から2枚を使用
  // ただし計算量削減のため、2枚の組み合わせを直接選ぶ
  const twoCardCombos = getCombinations(remainingDeck, 2);

  for (const holeCombo of twoCardCombos) {
    // コミュニティカードから3枚選ぶ
    const commCombos = getCombinations(communityCards, 3);
    for (const commCombo of commCombos) {
      const fiveCards = [...holeCombo, ...commCombo];
      const handRank = evaluateFiveCardHandForNuts(fiveCards);
      if (compareHands(handRank, bestHand) > 0) {
        bestHand = handRank;
      }
    }
  }

  return { rank: bestHand.rank, highCards: bestHand.highCards };
}

// 5枚のハンドを評価（handEvaluator.tsの内部関数と同じロジック）
function evaluateFiveCardHandForNuts(cards: Card[]): { rank: number; name: string; highCards: number[] } {
  const sortedCards = [...cards].sort((a, b) => getRankValue(b.rank) - getRankValue(a.rank));
  const values = sortedCards.map(c => getRankValue(c.rank));
  const suits = sortedCards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isStraight = checkStraight(values);
  const groups = getGroups(values);

  if (isFlush && isStraight) {
    return { rank: 9, name: 'ストレートフラッシュ', highCards: [getStraightHigh(values)] };
  }
  if (groups[0].count === 4) {
    return { rank: 8, name: 'フォーカード', highCards: [groups[0].value, groups[1].value] };
  }
  if (groups[0].count === 3 && groups[1].count === 2) {
    return { rank: 7, name: 'フルハウス', highCards: [groups[0].value, groups[1].value] };
  }
  if (isFlush) {
    return { rank: 6, name: 'フラッシュ', highCards: values };
  }
  if (isStraight) {
    return { rank: 5, name: 'ストレート', highCards: [getStraightHigh(values)] };
  }
  if (groups[0].count === 3) {
    return { rank: 4, name: 'スリーカード', highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }
  if (groups[0].count === 2 && groups[1].count === 2) {
    return { rank: 3, name: 'ツーペア', highCards: [groups[0].value, groups[1].value, groups[2].value] };
  }
  if (groups[0].count === 2) {
    return { rank: 2, name: 'ワンペア', highCards: [groups[0].value, groups[1].value, groups[2].value, groups[3].value] };
  }
  return { rank: 1, name: 'ハイカード', highCards: values };
}

function checkStraight(values: number[]): boolean {
  const sorted = [...values].sort((a, b) => b - a);
  let isNormalStraight = true;
  for (let i = 0; i < 4; i++) {
    if (sorted[i] - sorted[i + 1] !== 1) {
      isNormalStraight = false;
      break;
    }
  }
  if (isNormalStraight) return true;
  const wheel = [14, 5, 4, 3, 2];
  return sorted.every((v, i) => v === wheel[i]);
}

function getStraightHigh(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const wheel = [14, 5, 4, 3, 2];
  if (sorted.every((v, i) => v === wheel[i])) return 5;
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

// プレイヤーのエクイティをモンテカルロシミュレーションで計算
export function calculateEquity(
  holeCards: Card[],
  communityCards: Card[],
  numOpponents: number = 5,
  iterations: number = 500
): number {
  if (communityCards.length < 3) {
    // プリフロップは計算しない
    return -1;
  }

  const usedCards = [...holeCards, ...communityCards];
  const remainingDeck = getRemainingDeck(usedCards);

  let wins = 0;
  let ties = 0;

  for (let i = 0; i < iterations; i++) {
    // デッキをシャッフル
    const shuffled = [...remainingDeck].sort(() => Math.random() - 0.5);

    // 残りのコミュニティカードを配る
    const cardsNeeded = 5 - communityCards.length;
    const fullCommunity = [...communityCards, ...shuffled.slice(0, cardsNeeded)];
    let deckIndex = cardsNeeded;

    // 相手のハンドを生成
    const opponentHands: Card[][] = [];
    for (let o = 0; o < numOpponents; o++) {
      opponentHands.push(shuffled.slice(deckIndex, deckIndex + 4));
      deckIndex += 4;
    }

    // 自分のハンドを評価
    const myHand = evaluatePLOHand(holeCards, fullCommunity);

    // 相手のハンドを評価して比較
    let isBest = true;
    let isTie = false;

    for (const oppCards of opponentHands) {
      const oppHand = evaluatePLOHand(oppCards, fullCommunity);
      const cmp = compareHands(myHand, oppHand);
      if (cmp < 0) {
        isBest = false;
        break;
      } else if (cmp === 0) {
        isTie = true;
      }
    }

    if (isBest && !isTie) {
      wins++;
    } else if (isBest && isTie) {
      ties++;
    }
  }

  return ((wins + ties * 0.5) / iterations) * 100;
}

// アウツを計算（ナッツまたはセミナッツに到達できるカード）
export interface OutsInfo {
  totalOuts: number;
  nutOuts: number;        // ナッツになるアウツ
  strongOuts: number;     // セミナッツ（2番手以内）になるアウツ
  flushOuts: number;      // フラッシュドロー
  straightOuts: number;   // ストレートドロー
}

export function calculateOuts(
  holeCards: Card[],
  communityCards: Card[]
): OutsInfo {
  if (communityCards.length < 3 || communityCards.length >= 5) {
    return { totalOuts: 0, nutOuts: 0, strongOuts: 0, flushOuts: 0, straightOuts: 0 };
  }

  const usedCards = [...holeCards, ...communityCards];
  const remainingDeck = getRemainingDeck(usedCards);

  let nutOuts = 0;
  let strongOuts = 0;
  let flushOuts = 0;
  let straightOuts = 0;

  // 各追加カードでハンドがどう改善するかチェック
  for (const card of remainingDeck) {
    const testCommunity = [...communityCards, card];

    // 5枚揃った場合のみ完全評価
    if (testCommunity.length === 5) {
      const myHand = evaluatePLOHand(holeCards, testCommunity);
      const nuts = calculateNuts(testCommunity, getRemainingDeck([...holeCards, ...testCommunity]));

      // ナッツとの比較
      if (myHand.rank === nuts.rank) {
        // ハイカードも比較
        let isNuts = true;
        for (let i = 0; i < Math.min(myHand.highCards.length, nuts.highCards.length); i++) {
          if (myHand.highCards[i] < nuts.highCards[i]) {
            isNuts = false;
            break;
          }
        }
        if (isNuts) {
          nutOuts++;
        } else if (myHand.rank >= 5) { // ストレート以上
          strongOuts++;
        }
      } else if (myHand.rank >= nuts.rank - 1 && myHand.rank >= 5) {
        strongOuts++;
      }

      // フラッシュ/ストレートドローのチェック
      if (myHand.rank === 6) { // フラッシュ
        const hasFlushDraw = checkFlushDraw(holeCards, communityCards);
        if (hasFlushDraw && card.suit === hasFlushDraw) {
          flushOuts++;
        }
      }
      if (myHand.rank === 5) { // ストレート
        straightOuts++;
      }
    } else {
      // ターンの場合: 追加カード2枚の組み合わせを一部サンプリング
      const futureCards = remainingDeck.filter(c => c !== card).slice(0, 10);
      for (const card2 of futureCards) {
        const fullCommunity = [...communityCards, card, card2];
        const myHand = evaluatePLOHand(holeCards, fullCommunity);

        if (myHand.rank >= 6) { // フラッシュ以上
          const flushSuit = checkFlushDraw(holeCards, communityCards);
          if (flushSuit && card.suit === flushSuit) {
            flushOuts++;
            break;
          }
        }
        if (myHand.rank === 5) {
          straightOuts++;
          break;
        }
      }
    }
  }

  // ターン時のアウツ数を調整（サンプリングによる重複を除去）
  if (communityCards.length === 3) {
    flushOuts = Math.min(flushOuts, 9);  // フラッシュドローは最大9枚
    straightOuts = Math.min(straightOuts, 8); // オープンエンドは8枚
  }

  return {
    totalOuts: nutOuts + strongOuts,
    nutOuts,
    strongOuts,
    flushOuts: checkFlushDraw(holeCards, communityCards) ? Math.max(flushOuts, countFlushOuts(holeCards, communityCards, remainingDeck)) : 0,
    straightOuts: checkStraightDraw(holeCards, communityCards) ? Math.max(straightOuts, countStraightOuts(holeCards, communityCards, remainingDeck)) : 0,
  };
}

// フラッシュドローがあるかチェック
function checkFlushDraw(holeCards: Card[], communityCards: Card[]): Suit | null {
  const suitCounts: Record<Suit, { hole: number; comm: number }> = {
    h: { hole: 0, comm: 0 },
    d: { hole: 0, comm: 0 },
    c: { hole: 0, comm: 0 },
    s: { hole: 0, comm: 0 },
  };

  for (const card of holeCards) {
    suitCounts[card.suit].hole++;
  }
  for (const card of communityCards) {
    suitCounts[card.suit].comm++;
  }

  // PLOでは2枚のホールカードを使う必要がある
  for (const suit of ['h', 'd', 'c', 's'] as Suit[]) {
    if (suitCounts[suit].hole >= 2 && suitCounts[suit].comm >= 2) {
      return suit;
    }
  }
  return null;
}

// ストレートドローがあるかチェック
function checkStraightDraw(holeCards: Card[], communityCards: Card[]): boolean {
  const allCards = [...holeCards, ...communityCards];
  const values = new Set(allCards.map(c => getRankValue(c.rank)));

  // 4枚連続があるかチェック（オープンエンドまたはガットショット）
  for (let high = 14; high >= 5; high--) {
    let consecutive = 0;
    for (let v = high; v > high - 5 && v >= 1; v--) {
      const checkVal = v === 1 ? 14 : v; // Aは14
      if (values.has(checkVal)) {
        consecutive++;
      }
    }
    if (consecutive >= 4) return true;
  }
  return false;
}

// フラッシュアウツを数える
function countFlushOuts(holeCards: Card[], communityCards: Card[], remainingDeck: Card[]): number {
  const suit = checkFlushDraw(holeCards, communityCards);
  if (!suit) return 0;

  return remainingDeck.filter(c => c.suit === suit).length;
}

// ストレートアウツを数える
function countStraightOuts(holeCards: Card[], communityCards: Card[], remainingDeck: Card[]): number {
  const allCards = [...holeCards, ...communityCards];
  const values = allCards.map(c => getRankValue(c.rank));

  let outs = 0;
  for (const card of remainingDeck) {
    const testValues = [...values, getRankValue(card.rank)];
    const unique = [...new Set(testValues)].sort((a, b) => b - a);

    // 5枚連続があるかチェック
    for (let i = 0; i <= unique.length - 5; i++) {
      if (unique[i] - unique[i + 4] === 4) {
        outs++;
        break;
      }
    }
    // A-2-3-4-5チェック
    if (unique.includes(14) && unique.includes(2) && unique.includes(3) && unique.includes(4) && unique.includes(5)) {
      if (!outs) outs++;
    }
  }

  return Math.min(outs, 12); // 最大でも12枚程度
}
