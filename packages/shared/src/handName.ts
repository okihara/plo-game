import type { HandRank, Card } from './types';
import { getRankValue } from './deck';

const RANK_DISPLAY: Record<number, string> = {
  14: 'A',
  13: 'K',
  12: 'Q',
  11: 'J',
  10: 'T',
  9: '9',
  8: '8',
  7: '7',
  6: '6',
  5: '5',
  4: '4',
  3: '3',
  2: '2',
};

const PREFIXED_NAMES = new Set(['ストレート', 'フラッシュ', 'ストレートフラッシュ']);

export function formatHandName(rank: HandRank): string {
  if (PREFIXED_NAMES.has(rank.name) && rank.highCards.length > 0) {
    const label = RANK_DISPLAY[rank.highCards[0]];
    if (label) return `${label}${rank.name}`;
  }
  return rank.name;
}

/**
 * PLO のフラッシュ表示名を「ホール由来のスートマッチ最高ランク」で組み立てる。
 * 勝敗判定は実質ホール 2 枚で決まる（ボード由来 3 枚は両者共通）ので、
 * "Aフラッシュ" のようにボード A を強調するより、ホール由来のキッカーを
 * 表示するほうが PLO 的に正確。フラッシュが成立しない場合は素の "フラッシュ" を返す。
 */
export function formatPLOFlushName(holeCards: Card[], communityCards: Card[]): string {
  const SUITS: Card['suit'][] = ['s', 'h', 'd', 'c'];
  for (const suit of SUITS) {
    const holeRanks = holeCards.filter(c => c.suit === suit).map(c => getRankValue(c.rank)).sort((a, b) => b - a);
    const boardCount = communityCards.filter(c => c.suit === suit).length;
    // PLO フラッシュ条件: ホールに 2 枚以上 & ホール+ボード合計が 5 枚以上
    if (holeRanks.length >= 2 && holeRanks.length + boardCount >= 5) {
      const label = RANK_DISPLAY[holeRanks[0]];
      if (label) return `${label}フラッシュ`;
    }
  }
  return 'フラッシュ';
}
