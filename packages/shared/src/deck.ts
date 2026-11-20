import { Card, Rank, Suit } from './types';

const SUITS: Suit[] = ['h', 'd', 'c', 's'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function dealCards(deck: Card[], count: number): { cards: Card[]; remainingDeck: Card[] } {
  const cards = deck.slice(0, count);
  const remainingDeck = deck.slice(count);
  return { cards, remainingDeck };
}

/** ホールカード表示用のスート順（同ランク時の並び）: ♠ → ♥ → ♦ → ♣ */
const SUIT_SORT_ORDER: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };

/**
 * ホールカードを表示用に並べ替える（ランク降順、同ランクはスート順）。
 * 元の配列は変更せず新しい配列を返す。
 */
export function sortHoleCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) =>
    getRankValue(b.rank) - getRankValue(a.rank) || SUIT_SORT_ORDER[a.suit] - SUIT_SORT_ORDER[b.suit]
  );
}

export function cardToString(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function getRankValue(rank: Rank): number {
  const values: Record<Rank, number> = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14
  };
  return values[rank];
}
