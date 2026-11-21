import { describe, it, expect } from 'vitest';
import type { Card } from '@plo/shared';
import { sortHoleCards, sortHoleCardsForDisplay } from '@plo/shared';

const c = (s: string): Card => ({ rank: s[0] as Card['rank'], suit: s[1] as Card['suit'] });
const str = (cards: Card[]) => cards.map(x => `${x.rank}${x.suit}`).join(' ');

describe('sortHoleCards', () => {
  it('ランク降順に並べる', () => {
    expect(str(sortHoleCards([c('7h'), c('As'), c('Td'), c('Kc')]))).toBe('As Kc Td 7h');
  });

  it('同ランクはスート順（♠→♥→♦→♣）', () => {
    expect(str(sortHoleCards([c('Ac'), c('Ad'), c('Ks'), c('Ah'), c('As')]))).toBe('As Ah Ad Ac Ks');
  });

  it('元の配列を変更しない', () => {
    const input = [c('2c'), c('Ah')];
    sortHoleCards(input);
    expect(str(input)).toBe('2c Ah');
  });
});

describe('sortHoleCardsForDisplay', () => {
  const dealt = [c('7h'), c('As'), c('Td'), c('Kc'), c('2s')];

  it.each(['plo', 'plo5', 'plo_hilo', 'big_o', 'plo_double_board_bomb', 'limit_holdem'] as const)(
    '%s は並べ替える', (variant) => {
      expect(str(sortHoleCardsForDisplay(dealt, variant))).toBe('As Kc Td 7h 2s');
    },
  );

  it.each(['stud', 'razz', 'stud_hilo', 'limit_2-7_triple_draw', 'no_limit_2-7_single_draw'] as const)(
    '%s は配られた順のまま', (variant) => {
      expect(str(sortHoleCardsForDisplay(dealt, variant))).toBe('7h As Td Kc 2s');
    },
  );
});
