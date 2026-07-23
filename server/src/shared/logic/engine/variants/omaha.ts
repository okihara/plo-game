// Omaha ポットリミット系記述子（PLO / PLO5 / PLO6 / PLO8(plo_hilo) / Big-O）
// 配布枚数は VariantConfig.holeCardCount、Hi-Lo 系はショーダウンだけ分岐する。

import { getVariantConfig } from '../../types.js';
import { evaluatePLOHand, evaluateOmahaHiLoHand, compareHands, formatHandName } from '../../handEvaluator.js';
import { resolveHiLoShowdown } from '../../hiLoSplitPot.js';
import { resolvePotsByBestHand } from '../pots.js';
import { MAX_PLAYERS, assignBlindPostingPositions } from '../players.js';
import { potLimitBetting } from '../betting.js';
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

export const omahaDescriptor: VariantDescriptor = {
  resetHand(state) {
    state.currentStreet = 'preflop';
    state.currentBet = state.bigBlind;  // プリフロップではBBが最低ベット
    state.minRaise = state.bigBlind;
  },

  setup(state) {
    const activeCount = getActivePlayerCount(state);

    // === ブラインド位置の決定と投稿 ===
    const { sbIndex, bbIndex } = findBlindSeats(state, activeCount);
    assignBlindPostingPositions(state, state.dealerPosition, sbIndex, bbIndex, activeCount, MAX_PLAYERS);

    const sbPosted = postBlind(state, sbIndex, state.smallBlind);
    const bbPosted = postBlind(state, bbIndex, state.bigBlind);
    state.pot = sbPosted + bbPosted;

    // BBの投稿をフルレイズとして記録（プリフロップ特有）
    state.lastFullRaiseBet = state.currentBet;

    // === カードを配る（PLO: 4枚 / PLO5: 5枚 / PLO6: 6枚） ===
    dealHoleCardsToAll(state, getVariantConfig(state.variant).holeCardCount);

    // === アクション開始位置 ===
    state.currentPlayerIndex = preflopFirstActor(state, activeCount, sbIndex, bbIndex);
    // BBが最後のレイザーとして扱われる（プリフロップ特有）
    state.lastRaiserIndex = bbIndex;

    // アクション可能なプレイヤーがいない場合（全員オールイン）はショーダウンへ
    if (state.currentPlayerIndex === -1) {
      return runOutAndFinish(state, omahaDescriptor);
    }

    return state;
  },

  betting: potLimitBetting({
    minRaiseForStreet: (state) => state.bigBlind,
    minRaiseBeforeAdvance: (state) => state.bigBlind,
  }),

  flow: boardStreetFlow,

  showdown: {
    noDropStreet: 'preflop',
    rakeCapBase: (state) => state.bigBlind,
    buildPots: standardBuildPots,

    resolvePots(state, activePlayers, pots) {
      // === PLO Hi-Lo (PLO8) / Big-O はスプリット解決 ===
      if (state.variant === 'plo_hilo' || state.variant === 'big_o') {
        const showdownPlayers = activePlayers.map(p => ({ id: p.id, holeCards: p.holeCards }));
        const community = state.communityCards;
        return resolveHiLoShowdown(
          showdownPlayers,
          pots,
          (player) => evaluateOmahaHiLoHand(player.holeCards, community),
        );
      }

      // === PLOハンド評価（ホール2枚 + ボード3枚の組合せから最強） ===
      const hands = new Map<number, ReturnType<typeof evaluatePLOHand>>();
      for (const player of activePlayers) {
        hands.set(player.id, evaluatePLOHand(player.holeCards, state.communityCards));
      }
      return resolvePotsByBestHand(pots, hands, (a, b) => compareHands(b, a), formatHandName, state.chipUnit ?? 1);
    },
  },

  createTableState(variant, buyInChips, smallBlind, bigBlind) {
    const state = buildBaseGameState({
      playerChips: buyInChips,
      currentStreet: 'preflop',
      minRaise: 0,
      smallBlind: 1,
      bigBlind: 3,
      variant: 'plo',
    });
    // 配布枚数は startHand 内で variant.holeCardCount から動的に決まるため、
    // ここで variant を正しく設定しておく必要がある
    state.variant = variant;
    state.smallBlind = smallBlind;
    state.bigBlind = bigBlind;
    return state;
  },
};
