import { describe, it, expect } from 'vitest';
import type { Card } from '@plo/shared';
import { sortHoleCards } from '../deck.js';

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
