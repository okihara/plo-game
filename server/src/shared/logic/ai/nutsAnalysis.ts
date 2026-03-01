import { Card, Suit } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluatePLOHand, compareHands } from '../handEvaluator.js';

export interface RiverNutsAnalysis {
  nutRank: number;                // 1=ナッツ, 2=セカンドナッツ, ...
  possibleBetterHands: string[];  // 自分より上の手の種類 ['flush', 'full_house', ...]
  absoluteNutType: string;        // このボードの絶対ナッツの種類
}

/**
 * リバーでのナッツ分析。
 * ボード上で理論的に可能なハンドを列挙し、自分のハンドの相対位置を算出。
 * PLOルール: 相手はホール4枚から2枚 + コミュニティ5枚から3枚を使用。
 */
export function analyzeRiverNuts(
  holeCards: Card[],
  communityCards: Card[],
  myHandRank: number,
  myHighCards: number[]
): RiverNutsAnalysis {
  if (communityCards.length !== 5) {
    return { nutRank: 1, possibleBetterHands: [], absoluteNutType: 'unknown' };
  }

  const boardValues = communityCards.map(c => getRankValue(c.rank)).sort((a, b) => b - a);
  const usedCards = new Set([
    ...holeCards.map(c => `${c.rank}${c.suit}`),
    ...communityCards.map(c => `${c.rank}${c.suit}`),
  ]);

  const possibleBetterHands: string[] = [];

  // === 1. ストレートフラッシュの脅威 ===
  if (myHandRank < 9 && isStraightFlushPossible(communityCards, usedCards)) {
    possibleBetterHands.push('straight_flush');
  }

  // === 2. クワッズの脅威 ===
  if (myHandRank < 8 && isQuadsPossible(communityCards, usedCards)) {
    possibleBetterHands.push('quads');
  }

  // === 3. フルハウスの脅威 ===
  if (myHandRank < 7 && isFullHousePossible(communityCards, usedCards)) {
    possibleBetterHands.push('full_house');
  } else if (myHandRank === 7) {
    // 自分もフルハウス — より高いフルハウスが存在するか
    if (isBetterFullHousePossible(communityCards, usedCards, myHighCards)) {
      possibleBetterHands.push('better_full_house');
    }
  }

  // === 4. フラッシュの脅威 ===
  if (myHandRank < 6) {
    const flushThreat = getFlushThreat(communityCards, usedCards);
    if (flushThreat) {
      possibleBetterHands.push('flush');
    }
  } else if (myHandRank === 6) {
    // 自分もフラッシュ — より高いフラッシュが存在するか
    const betterFlushCount = countBetterFlushes(holeCards, communityCards, usedCards, myHighCards);
    for (let i = 0; i < betterFlushCount; i++) {
      possibleBetterHands.push('better_flush');
    }
  }

  // === 5. ストレートの脅威 ===
  if (myHandRank < 5) {
    if (isStraightPossible(communityCards, usedCards)) {
      possibleBetterHands.push('straight');
    }
  } else if (myHandRank === 5) {
    // 自分もストレート — より高いストレートが存在するか
    const betterStraightCount = countBetterStraights(communityCards, usedCards, myHighCards[0]);
    for (let i = 0; i < betterStraightCount; i++) {
      possibleBetterHands.push('better_straight');
    }
  }

  // nutRank 算出
  const nutRank = possibleBetterHands.length + 1;

  // 絶対ナッツのタイプを決定
  let absoluteNutType = 'unknown';
  if (isStraightFlushPossible(communityCards, usedCards)) absoluteNutType = 'straight_flush';
  else if (isQuadsPossible(communityCards, usedCards)) absoluteNutType = 'quads';
  else if (isFullHousePossible(communityCards, usedCards)) absoluteNutType = 'full_house';
  else if (getFlushThreat(communityCards, usedCards)) absoluteNutType = 'flush';
  else if (isStraightPossible(communityCards, usedCards)) absoluteNutType = 'straight';
  else absoluteNutType = 'set_or_lower';

  return { nutRank, possibleBetterHands, absoluteNutType };
}

/**
 * ストレートフラッシュが可能か。
 * 同スート3枚以上 + そのスートで連続5枚が成立しうるか。
 */
function isStraightFlushPossible(communityCards: Card[], usedCards: Set<string>): boolean {
  const suits: Suit[] = ['h', 'd', 'c', 's'];

  for (const suit of suits) {
    const boardOfSuit = communityCards.filter(c => c.suit === suit).map(c => getRankValue(c.rank));
    if (boardOfSuit.length < 3) continue;

    // ボードのスートカード3枚を使い、残り2枚を足してストレートフラッシュになるか
    // ボードから3枚の組み合わせを試行
    const combos3 = getCombos(boardOfSuit, 3);
    for (const three of combos3) {
      // この3枚と組み合わせて5枚連続になる2枚が存在するか
      for (let high = 14; high >= 5; high--) {
        const needed = [];
        for (let v = high; v > high - 5; v--) {
          const val = v === 1 ? 14 : v; // A=14
          if (!three.includes(val)) needed.push(val);
        }
        if (needed.length === 2 && three.every(v => v >= high - 4 && v <= high)) {
          // 2枚が未使用カードとして存在するか
          const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
          const available = needed.every(v => {
            const r = ranks[v - 2] || (v === 14 ? 'A' : undefined);
            return r && !usedCards.has(`${r}${suit}`);
          });
          if (available) return true;
        }
      }
    }
  }
  return false;
}

/**
 * クワッズが可能か。ボードにペアまたはトリップスがある場合。
 */
function isQuadsPossible(communityCards: Card[], usedCards: Set<string>): boolean {
  const valueCounts = new Map<number, number>();
  for (const c of communityCards) {
    const v = getRankValue(c.rank);
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }

  for (const [value, count] of valueCounts) {
    const needed = 4 - count; // 残り何枚必要か
    if (needed > 2) continue; // PLOでは2枚しか使えない
    // 未使用のカードが enough 枚存在するか
    const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
    const rank = ranks[value - 2] || (value === 14 ? 'A' : undefined);
    if (!rank) continue;
    const suits: Suit[] = ['h', 'd', 'c', 's'];
    const available = suits.filter(s => !usedCards.has(`${rank}${s}`));
    if (available.length >= needed) return true;
  }
  return false;
}

/**
 * フルハウスが可能か。
 */
function isFullHousePossible(communityCards: Card[], usedCards: Set<string>): boolean {
  const valueCounts = new Map<number, number>();
  for (const c of communityCards) {
    const v = getRankValue(c.rank);
    valueCounts.set(v, (valueCounts.get(v) || 0) + 1);
  }

  // ボードにペアがある → 相手がそのランクの3枚目を持てばトリップス→FH
  // ボードにトリップスがある → 相手がペアを持てばFH
  // ボードに2つのペアがある → 片方のトリップスで即FH
  const pairs = [...valueCounts.entries()].filter(([, c]) => c >= 2);
  const trips = [...valueCounts.entries()].filter(([, c]) => c >= 3);

  if (trips.length > 0) return true; // トリップスボード → ペア持ちでFH
  if (pairs.length >= 2) return true; // ダブルペアボード → どちらかのトリップスでFH
  if (pairs.length === 1) {
    // シングルペアボード → 別ランクのペアを2枚持てばFH
    return true; // PLOでは4枚ホールなのでペア持ちは十分ありえる
  }

  // ペアなしボード → 相手がボードランクのペア2枚を持てばFH可能だが
  // PLOでは2枚しか使えないのでセット→FH or ペアボード必要
  // ボードのランクのポケットペアを持っていればセット → 他のボードカードでペア
  // ただしペアなしボードでは5種類のランクが出ている
  // 相手がポケットペア(ボードのいずれかと一致) → セット → 残り2枚でペア → FH
  // これは理論的には可能
  return valueCounts.size < 5; // 5種類未満 = 何らかの重複あり
}

/**
 * 自分のフルハウスより強いフルハウスが可能か。
 */
function isBetterFullHousePossible(
  communityCards: Card[],
  usedCards: Set<string>,
  myHighCards: number[]
): boolean {
  const boardValues = communityCards.map(c => getRankValue(c.rank));
  const myTripsValue = myHighCards[0]; // FHのトリップス部分

  // ボード上で自分のトリップスより高いランクのセットが作れるか
  for (const bv of new Set(boardValues)) {
    if (bv <= myTripsValue) continue;
    // このランクのポケットペアを相手が持っていればより高いセット→FH
    const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
    const rank = ranks[bv - 2] || (bv === 14 ? 'A' : undefined);
    if (!rank) continue;
    const suits: Suit[] = ['h', 'd', 'c', 's'];
    const available = suits.filter(s => !usedCards.has(`${rank}${s}`));
    if (available.length >= 2) return true;
  }
  return false;
}

/**
 * フラッシュが可能か。同スート3枚以上で、未使用の同スートカードが2枚以上。
 */
function getFlushThreat(communityCards: Card[], usedCards: Set<string>): boolean {
  const suits: Suit[] = ['h', 'd', 'c', 's'];
  for (const suit of suits) {
    const boardCount = communityCards.filter(c => c.suit === suit).length;
    if (boardCount < 3) continue;
    // 未使用の同スートカードが2枚以上あるか
    const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
    const available = ranks.filter(r => !usedCards.has(`${r}${suit}`));
    if (available.length >= 2) return true;
  }
  return false;
}

/**
 * 自分のフラッシュより高いフラッシュが何段階存在するか。
 */
function countBetterFlushes(
  holeCards: Card[],
  communityCards: Card[],
  usedCards: Set<string>,
  myHighCards: number[]
): number {
  // 自分のフラッシュのスートを特定
  const suits: Suit[] = ['h', 'd', 'c', 's'];
  let flushSuit: Suit | null = null;
  for (const suit of suits) {
    const holeOfSuit = holeCards.filter(c => c.suit === suit);
    const boardOfSuit = communityCards.filter(c => c.suit === suit);
    if (holeOfSuit.length >= 2 && boardOfSuit.length >= 3) {
      flushSuit = suit;
      break;
    }
  }
  if (!flushSuit) return 0;

  // ボードの同スートカードで最高の3枚を取得
  const boardFlushValues = communityCards
    .filter(c => c.suit === flushSuit)
    .map(c => getRankValue(c.rank))
    .sort((a, b) => b - a)
    .slice(0, 3);

  // 未使用の同スートカードを降順で列挙
  const allRanks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
  const availableSuitCards = allRanks
    .filter(r => !usedCards.has(`${r}${flushSuit}`))
    .map(r => getRankValue(r))
    .sort((a, b) => b - a);

  // 自分のフラッシュのホールカード部分（フラッシュスートの2枚）
  const myFlushHoleValues = holeCards
    .filter(c => c.suit === flushSuit)
    .map(c => getRankValue(c.rank))
    .sort((a, b) => b - a)
    .slice(0, 2);

  // 相手が持ちうるフラッシュのホール2枚の組み合わせで、自分より強いもの数える
  let betterCount = 0;
  for (let i = 0; i < availableSuitCards.length; i++) {
    for (let j = i + 1; j < availableSuitCards.length; j++) {
      const oppHigh = [availableSuitCards[i], availableSuitCards[j]];
      // 相手のフラッシュ = ボード3枚 + oppHigh 2枚 → 最高5枚
      const oppFlush = [...boardFlushValues, ...oppHigh].sort((a, b) => b - a).slice(0, 5);
      const myFlush = [...boardFlushValues, ...myFlushHoleValues].sort((a, b) => b - a).slice(0, 5);

      // 比較
      let better = false;
      for (let k = 0; k < 5; k++) {
        if (oppFlush[k] > myFlush[k]) { better = true; break; }
        if (oppFlush[k] < myFlush[k]) break;
      }
      if (better) {
        betterCount++;
        if (betterCount >= 3) return betterCount; // 上限3で打ち切り
      }
    }
  }
  return betterCount;
}

/**
 * ストレートが可能か。
 * ボードから3枚使って5枚連続になる2枚が存在するか。
 */
function isStraightPossible(communityCards: Card[], usedCards: Set<string>): boolean {
  const boardValues = [...new Set(communityCards.map(c => getRankValue(c.rank)))];

  // ボードから3枚を選び、残り2枚を足してストレートになるか
  const combos3 = getCombos(boardValues, 3);
  for (const three of combos3) {
    for (let high = 14; high >= 5; high--) {
      const straight: number[] = [];
      for (let v = high; v > high - 5; v--) {
        straight.push(v === 0 ? 14 : v);
      }
      // ホイール: A-2-3-4-5
      if (high === 5) {
        straight[0] = 5; straight[1] = 4; straight[2] = 3; straight[3] = 2; straight[4] = 14;
      }

      // 3枚がこのストレートに含まれるか
      const threeInStraight = three.every(v => straight.includes(v));
      if (!threeInStraight) continue;

      // 残り2枚
      const needed = straight.filter(v => !three.includes(v));
      if (needed.length !== 2) continue;

      // 必要な2枚のうち、少なくとも1つのスートが利用可能か
      const allAvailable = needed.every(v => {
        const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
        const rank = v === 14 ? 'A' : ranks[v - 2];
        if (!rank) return false;
        const suits: Suit[] = ['h', 'd', 'c', 's'];
        return suits.some(s => !usedCards.has(`${rank}${s}`));
      });
      if (allAvailable) return true;
    }
  }
  return false;
}

/**
 * 自分のストレートより高いストレートが何段階存在するか。
 */
function countBetterStraights(
  communityCards: Card[],
  usedCards: Set<string>,
  myStraightHigh: number
): number {
  const boardValues = [...new Set(communityCards.map(c => getRankValue(c.rank)))];
  let betterCount = 0;

  const combos3 = getCombos(boardValues, 3);
  const foundHighs = new Set<number>();

  for (const three of combos3) {
    for (let high = 14; high > myStraightHigh; high--) {
      if (foundHighs.has(high)) continue;

      const straight: number[] = [];
      for (let v = high; v > high - 5; v--) {
        straight.push(v);
      }

      const threeInStraight = three.every(v => straight.includes(v));
      if (!threeInStraight) continue;

      const needed = straight.filter(v => !three.includes(v));
      if (needed.length !== 2) continue;

      const allAvailable = needed.every(v => {
        const ranks = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'] as const;
        const rank = v === 14 ? 'A' : ranks[v - 2];
        if (!rank) return false;
        const suits: Suit[] = ['h', 'd', 'c', 's'];
        return suits.some(s => !usedCards.has(`${rank}${s}`));
      });
      if (allAvailable) {
        foundHighs.add(high);
        betterCount++;
        if (betterCount >= 3) return betterCount;
      }
    }
  }
  return betterCount;
}

/** 配列からn個を選ぶ組み合わせ */
function getCombos(arr: number[], n: number): number[][] {
  const result: number[][] = [];
  function combine(start: number, combo: number[]) {
    if (combo.length === n) { result.push([...combo]); return; }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      combine(i + 1, combo);
      combo.pop();
    }
  }
  combine(0, []);
  return result;
}
