/**
 * ステップ2: PLOエクイティ計算エンジン
 *
 * ハンドA vs ハンドB のオールインエクイティをモンテカルロで計算。
 * PLOルール: ホール4枚から必ず2枚、ボード5枚から必ず3枚を使う。
 */

import { cardRank, cardSuit, DECK_SIZE } from './enumerate.js';

// --- 高速5枚ハンド評価 ---
// HandRank を1つの整数にエンコードして比較を高速化

/**
 * 5枚のカード（rank 0-12）からハンドランクを整数で返す。
 * 大きい方が強い。
 *
 * エンコード: category * 10^6 + tiebreaker
 * category: 1=ハイカード, 2=ワンペア, ... 9=ストレートフラッシュ
 */
export function evaluate5(cards: number[]): number {
  // ranks を降順ソート (0-12, 0=2, 12=A)
  const r = cards.map(cardRank).sort((a, b) => b - a);
  const s = cards.map(cardSuit);

  const isFlush = s[0] === s[1] && s[1] === s[2] && s[2] === s[3] && s[3] === s[4];

  // ストレート判定
  let isStraight = false;
  let straightHigh = 0;

  // 通常ストレート
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1 && r[2] - r[3] === 1 && r[3] - r[4] === 1) {
    isStraight = true;
    straightHigh = r[0];
  }
  // ホイール A-2-3-4-5 (r = [12, 3, 2, 1, 0])
  if (!isStraight && r[0] === 12 && r[1] === 3 && r[2] === 2 && r[3] === 1 && r[4] === 0) {
    isStraight = true;
    straightHigh = 3; // 5がハイ (rank 3)
  }

  // グループ化
  const counts: number[] = new Array(13).fill(0);
  for (const rank of r) counts[rank]++;

  // グループを (count, rank) で降順ソート
  const groups: { count: number; rank: number }[] = [];
  for (let i = 12; i >= 0; i--) {
    if (counts[i] > 0) groups.push({ count: counts[i], rank: i });
  }
  groups.sort((a, b) => b.count !== a.count ? b.count - a.count : b.rank - a.rank);

  // tiebreaker: groups の rank を桁で並べる（最大5桁, 各2桁 = 13^5以下）
  function tiebreaker(ranks: number[]): number {
    let v = 0;
    for (const r of ranks) v = v * 13 + r;
    return v;
  }

  // ストレートフラッシュ
  if (isFlush && isStraight) {
    return 9_000_000 + straightHigh;
  }
  // フォーカード
  if (groups[0].count === 4) {
    return 8_000_000 + tiebreaker([groups[0].rank, groups[1].rank]);
  }
  // フルハウス
  if (groups[0].count === 3 && groups[1].count === 2) {
    return 7_000_000 + tiebreaker([groups[0].rank, groups[1].rank]);
  }
  // フラッシュ
  if (isFlush) {
    return 6_000_000 + tiebreaker(r);
  }
  // ストレート
  if (isStraight) {
    return 5_000_000 + straightHigh;
  }
  // スリーカード
  if (groups[0].count === 3) {
    return 4_000_000 + tiebreaker(groups.map(g => g.rank));
  }
  // ツーペア
  if (groups[0].count === 2 && groups[1].count === 2) {
    return 3_000_000 + tiebreaker(groups.map(g => g.rank));
  }
  // ワンペア
  if (groups[0].count === 2) {
    return 2_000_000 + tiebreaker(groups.map(g => g.rank));
  }
  // ハイカード
  return 1_000_000 + tiebreaker(r);
}

/**
 * PLOベストハンド: ホール4枚から2枚、ボード5枚から3枚を選んだ最強の5枚ハンド
 */
export function evaluatePLO(hole: number[], board: number[]): number {
  let best = 0;
  // C(4,2) = 6通り
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      // C(5,3) = 10通り
      for (let k = 0; k < 5; k++) {
        for (let l = k + 1; l < 5; l++) {
          for (let m = l + 1; m < 5; m++) {
            const hand = [hole[i], hole[j], board[k], board[l], board[m]];
            const rank = evaluate5(hand);
            if (rank > best) best = rank;
          }
        }
      }
    }
  }
  return best;
}

// --- モンテカルロ エクイティ ---

/**
 * handA vs handB のエクイティ（handA の勝率 0-1）をモンテカルロで計算。
 * カードが重複する場合（同じカードを含む）は NaN を返す。
 */
export function monteCarloEquity(
  handA: number[],
  handB: number[],
  iterations: number,
): number {
  // デッドカード
  const dead = new Set([...handA, ...handB]);
  if (dead.size !== 8) return NaN; // カード重複

  // 残りデッキ
  const deck: number[] = [];
  for (let i = 0; i < DECK_SIZE; i++) {
    if (!dead.has(i)) deck.push(i);
  }
  // deck.length = 44

  let wins = 0;
  let ties = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Fisher-Yatesで5枚だけシャッフル
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(Math.random() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const board = [deck[0], deck[1], deck[2], deck[3], deck[4]];

    const rankA = evaluatePLO(handA, board);
    const rankB = evaluatePLO(handB, board);

    if (rankA > rankB) wins++;
    else if (rankA === rankB) ties++;
  }

  return (wins + ties * 0.5) / iterations;
}

/**
 * hand vs レンジ（複数のハンド+重み）のエクイティを計算。
 * CFR で使用: 特定ハンドが相手レンジに対してどれだけ勝てるか。
 */
export function equityVsRange(
  hand: number[],
  range: { hand: number[]; weight: number }[],
  iterationsPerMatchup: number,
): number {
  let totalEquity = 0;
  let totalWeight = 0;

  for (const opponent of range) {
    // カード重複チェック
    const dead = new Set([...hand, ...opponent.hand]);
    if (dead.size !== 8) continue; // 重複するハンドはスキップ

    const eq = monteCarloEquity(hand, opponent.hand, iterationsPerMatchup);
    if (!isNaN(eq)) {
      totalEquity += eq * opponent.weight;
      totalWeight += opponent.weight;
    }
  }

  return totalWeight > 0 ? totalEquity / totalWeight : 0.5;
}
