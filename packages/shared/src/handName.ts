import type { HandRank } from './types';

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
