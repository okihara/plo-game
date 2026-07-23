// Stud 系記述子（7 Card Stud / Razz / Stud Hi-Lo）
// アンテ + ブリングイン、コミュニティカードなし（裏2枚 + 表4枚 + 裏1枚）。
// ブリングイン順・アクション順・ショーダウン評価は StudVariantRules に委譲する。

import { GameState, GameVariant, Street, getUpCards } from '../../types.js';
import { dealCards } from '../../deck.js';
import { StudVariantRules } from '../../studVariantRules.js';
import { MAX_PLAYERS, rotatePositionLabels } from '../players.js';
import { studFixedLimitBetting } from '../betting.js';
import { VariantDescriptor } from '../descriptor.js';
import { buildBaseGameState, standardBuildPots } from '../core.js';

/** 3rd/4th street = small bet, 5th/6th/7th = big bet */
function studBetSize(state: GameState): number {
  if (state.currentStreet === 'third' || state.currentStreet === 'fourth') {
    return state.smallBlind; // smallBlind = small bet
  }
  return state.bigBlind; // bigBlind = big bet
}

const NEXT_STREET: Partial<Record<Street, Street>> = {
  third: 'fourth',
  fourth: 'fifth',
  fifth: 'sixth',
  sixth: 'seventh',
  seventh: 'showdown',
};

/** アクティブプレイヤーに7枚になるまでカードを配る（表4枚上限、7枚目は裏） */
function studDealRemaining(state: GameState): void {
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[i];
    if (p.isSittingOut || p.folded) continue;

    if (p.holeCards.length >= 7) continue;

    // 表カードは最大4枚まで（6枚目まで）
    while (getUpCards(p.holeCards).length < 4 && p.holeCards.length < 6 && state.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(state.deck, 1);
      p.holeCards.push(...cards.map(c => ({ ...c, isUp: true })));
      state.deck = remainingDeck;
    }
    // 7枚目は裏カード
    if (p.holeCards.length < 7 && state.deck.length > 0) {
      const { cards, remainingDeck } = dealCards(state.deck, 1);
      p.holeCards.push(...cards.map(c => ({ ...c, isUp: false })));
      state.deck = remainingDeck;
    }
  }
}

function makeStudDescriptor(rules: StudVariantRules): VariantDescriptor {
  const descriptor: VariantDescriptor = {
    resetHand(state) {
      state.currentStreet = 'third';
      state.betCount = 0;
    },

    setup(state) {
      // Stud はブラインドではなくディーラー基準の機械的なポジション名
      rotatePositionLabels(state);

      // === アンテ徴収 ===
      for (let i = 0; i < MAX_PLAYERS; i++) {
        const p = state.players[i];
        if (p.isSittingOut) continue;
        const anteAmount = Math.min(state.ante, p.chips);
        p.chips -= anteAmount;
        p.totalBetThisRound += anteAmount;
        state.pot += anteAmount;
        if (p.chips === 0) p.isAllIn = true;
      }

      // === カード配布: 裏2枚 + 表1枚（ドアカード）配布順で格納 ===
      for (let i = 0; i < MAX_PLAYERS; i++) {
        if (state.players[i].isSittingOut) continue;
        const down = dealCards(state.deck, 2);
        state.deck = down.remainingDeck;
        const up = dealCards(state.deck, 1);
        state.deck = up.remainingDeck;
        state.players[i].holeCards = [
          ...down.cards.map(c => ({ ...c, isUp: false })),
          ...up.cards.map(c => ({ ...c, isUp: true })),
        ];
      }

      // === ブリングイン: ルールが決めたプレイヤーが最初に行動 ===
      const bringInPlayer = rules.findBringInPlayer(state);
      if (bringInPlayer === -1) return state;

      state.currentPlayerIndex = bringInPlayer;
      state.lastRaiserIndex = -1;

      return state;
    },

    betting: studFixedLimitBetting(studBetSize),

    flow: {
      nextStreet(state) {
        return NEXT_STREET[state.currentStreet] ?? 'showdown';
      },
      onEnterStreet(state) {
        // 4th-6th street: 表カード, 7th street: 裏カード
        const isUp = state.currentStreet !== 'seventh';
        for (let i = 0; i < MAX_PLAYERS; i++) {
          const p = state.players[i];
          if (p.isSittingOut || p.folded) continue;
          const { cards, remainingDeck } = dealCards(state.deck, 1);
          state.deck = remainingDeck;
          p.holeCards.push(...cards.map(c => ({ ...c, isUp })));
        }
      },
      firstToAct(state) {
        return rules.findFirstToAct(state);
      },
      whenBettingImpossible: 'runout',
      runOutDealsBeforeShowdown: false,
      runOut: studDealRemaining,
    },

    showdown: {
      noDropStreet: 'third',
      rakeCapBase: (state) => state.bigBlind,
      buildPots: standardBuildPots,
      resolvePots(_state, activePlayers, pots) {
        const showdownPlayers = activePlayers.map(p => ({ id: p.id, holeCards: p.holeCards }));
        return rules.resolveShowdown(showdownPlayers, pots);
      },
    },

    createTableState(variant, buyInChips, smallBlind) {
      // Stud は SB を 1/4 にしたものを ante として使う既存ルール (blind level の ante は未使用)
      const studAnte = Math.ceil(smallBlind / 4);
      return createStudBaseState(buyInChips, studAnte, smallBlind, variant);
    },
  };
  return descriptor;
}

/** Stud 用の初期 GameState（シムの createStudGameState と共用） */
export function createStudBaseState(playerChips: number, ante: number, smallBet: number, variant: GameVariant): GameState {
  return buildBaseGameState({
    playerChips,
    currentStreet: 'third',
    minRaise: smallBet,
    smallBlind: smallBet,       // Stud: small bet 額
    bigBlind: smallBet * 2,     // Stud: big bet 額
    variant,
    ante,
    bringIn: Math.ceil(ante / 2) || 1, // ブリングイン = アンテの半額（切り上げ）
    maxBetsPerRound: 4,
  });
}

// rules インスタンスごとに記述子をキャッシュ（VariantAdapter は adapter ごとに 1 つの rules を保持する）
const descriptorCache = new WeakMap<StudVariantRules, VariantDescriptor>();

export function studDescriptorFor(rules: StudVariantRules): VariantDescriptor {
  let d = descriptorCache.get(rules);
  if (!d) {
    d = makeStudDescriptor(rules);
    descriptorCache.set(rules, d);
  }
  return d;
}
