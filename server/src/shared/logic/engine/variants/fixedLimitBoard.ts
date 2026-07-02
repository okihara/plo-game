// Fixed Limit のボードゲーム系記述子（Limit Hold'em / Omaha Hi-Lo）
// preflop/flop = small bet, turn/river = big bet。
// SB は small bet の半額、BB は small bet を投稿する。

import { GameState, GameVariant, Player } from '../../types.js';
import { evaluateHoldemHand, evaluateOmahaHiLoHand, compareHands, formatHandName } from '../../handEvaluator.js';
import { resolveHiLoShowdown } from '../../hiLoSplitPot.js';
import { MAX_PLAYERS, assignBlindPostingPositions } from '../players.js';
import { boardFixedLimitBetting } from '../betting.js';
import { resolvePotsByBestHand, SidePot, PotWinnerEntry } from '../pots.js';
import { VariantDescriptor } from '../descriptor.js';
import {
  buildBaseGameState,
  findBlindSeats,
  postBlind,
  dealHoleCardsToAll,
  preflopFirstActor,
  getActivePlayerCount,
  runOutAndFinish,
  standardBuildPots,
} from '../core.js';
import { boardStreetFlow } from './boardFlow.js';

/** preflop/flop = small bet (= smallBlind), turn/river = big bet (= bigBlind) */
function boardBetSize(state: GameState): number {
  if (state.currentStreet === 'preflop' || state.currentStreet === 'flop') {
    return state.smallBlind;
  }
  return state.bigBlind;
}

const MAX_BETS_PER_ROUND = 4; // bet + 3 raises

function makeFixedLimitBoardDescriptor(opts: {
  variant: GameVariant;
  holeCardCount: number;
  resolvePots(state: GameState, activePlayers: Player[], pots: SidePot[]): PotWinnerEntry[];
}): VariantDescriptor {
  const descriptor: VariantDescriptor = {
    resetHand(state) {
      state.currentStreet = 'preflop';
      state.currentBet = state.smallBlind; // preflop は small bet がベッティング単位
      state.minRaise = state.smallBlind;
      state.betCount = 1; // BBの投稿を1ベットとカウント
    },

    setup(state) {
      const sb = state.smallBlind;
      const activeCount = getActivePlayerCount(state);

      const { sbIndex, bbIndex } = findBlindSeats(state, activeCount);
      assignBlindPostingPositions(state, state.dealerPosition, sbIndex, bbIndex, activeCount, MAX_PLAYERS);

      // SBポスト (= small bet / 2)、BBポスト (= small bet)
      const sbPosted = postBlind(state, sbIndex, Math.floor(sb / 2));
      const bbPosted = postBlind(state, bbIndex, sb);
      state.pot = sbPosted + bbPosted;
      state.currentBet = bbPosted;
      state.lastFullRaiseBet = state.currentBet;

      dealHoleCardsToAll(state, opts.holeCardCount);

      state.currentPlayerIndex = preflopFirstActor(state, activeCount, sbIndex, bbIndex);
      state.lastRaiserIndex = bbIndex;

      if (state.currentPlayerIndex === -1) {
        return runOutAndFinish(state, descriptor);
      }

      return state;
    },

    betting: boardFixedLimitBetting(boardBetSize),
    flow: boardStreetFlow,

    showdown: {
      noDropStreet: 'preflop',
      rakeCapBase: (state) => state.bigBlind,
      buildPots: standardBuildPots,
      resolvePots: opts.resolvePots,
    },

    createTableState(_variant, buyInChips, smallBlind, bigBlind) {
      return buildBaseGameState({
        playerChips: buyInChips,
        currentStreet: 'preflop',
        minRaise: smallBlind,
        smallBlind,
        bigBlind,
        variant: opts.variant,
        maxBetsPerRound: MAX_BETS_PER_ROUND,
      });
    },
  };
  return descriptor;
}

/** Limit Hold'em: 7枚（ホール2 + ボード5）から最強5枚 */
export const limitHoldemDescriptor = makeFixedLimitBoardDescriptor({
  variant: 'limit_holdem',
  holeCardCount: 2,
  resolvePots(state, activePlayers, pots) {
    const hands = new Map<number, ReturnType<typeof evaluateHoldemHand>>();
    for (const player of activePlayers) {
      hands.set(player.id, evaluateHoldemHand(player.holeCards, state.communityCards));
    }
    return resolvePotsByBestHand(pots, hands, (a, b) => compareHands(b, a), formatHandName, 1);
  },
});

/** Omaha Hi-Lo (8-or-Better): ハイ/ローでポットをスプリット */
export const omahaHiLoDescriptor = makeFixedLimitBoardDescriptor({
  variant: 'omaha_hilo',
  holeCardCount: 4,
  resolvePots(state, activePlayers, pots) {
    const showdownPlayers = activePlayers.map(p => ({ id: p.id, holeCards: p.holeCards }));
    const community = state.communityCards;
    return resolveHiLoShowdown(
      showdownPlayers,
      pots,
      (player) => evaluateOmahaHiLoHand(player.holeCards, community),
    );
  },
});
