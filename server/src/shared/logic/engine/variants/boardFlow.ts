// コミュニティカードを使うバリアント（PLO 系 / Limit Hold'em / Omaha Hi-Lo）共通の
// ストリート進行: preflop → flop(3枚) → turn(1枚) → river(1枚) → showdown

import { GameState, Street } from '../../types.js';
import { dealCards } from '../../deck.js';
import { findFirstActorFromSb } from '../players.js';
import { StreetFlowRules } from '../descriptor.js';

const NEXT_STREET: Partial<Record<Street, Street>> = {
  preflop: 'flop',
  flop: 'turn',
  turn: 'river',
  river: 'showdown',
};

/** コミュニティカードを5枚になるまで配りきる */
export function runOutCommunityCards(state: GameState): void {
  while (state.communityCards.length < 5 && state.deck.length > 0) {
    const { cards, remainingDeck } = dealCards(state.deck, 1);
    state.communityCards.push(...cards);
    state.deck = remainingDeck;
  }
}

export const boardStreetFlow: StreetFlowRules = {
  nextStreet(state) {
    return NEXT_STREET[state.currentStreet] ?? 'showdown';
  },

  onEnterStreet(state) {
    if (state.currentStreet === 'flop') {
      const { cards, remainingDeck } = dealCards(state.deck, 3);
      state.communityCards = cards;
      state.deck = remainingDeck;
    } else {
      const { cards, remainingDeck } = dealCards(state.deck, 1);
      state.communityCards.push(...cards);
      state.deck = remainingDeck;
    }
  },

  firstToAct(state) {
    // ポストフロップは SB（ディーラーの次）から時計回りで最初のアクティブプレイヤー
    return findFirstActorFromSb(state);
  },

  whenBettingImpossible: 'runout',
  runOutDealsBeforeShowdown: true,
  runOut: runOutCommunityCards,
};
