// Draw 系記述子（Limit 2-7 Triple Draw / No-Limit 2-7 Single Draw）
// ベッティングとドロー（カード交換）が交互に進む。
// Single Draw は No-Limit + BBアンティ（デッドマネー）対応。

import { GameState, GameVariant, Street, Card, isDrawStreet } from '../../types.js';
import { dealCards, shuffleDeck } from '../../deck.js';
import { evaluate27LowHand, compare27LowHands, formatHandName } from '../../handEvaluator.js';
import { MAX_PLAYERS, assignBlindPostingPositions, findFirstActorFromSb, getActivePlayers } from '../players.js';
import { noLimitBetting, drawFixedLimitBetting } from '../betting.js';
import { calculateSidePots, settleUncontestedPots, resolvePotsByBestHand } from '../pots.js';
import { VariantDescriptor, BettingRules } from '../descriptor.js';
import {
  buildBaseGameState,
  findBlindSeats,
  postBlind,
  dealHoleCardsToAll,
  preflopFirstActor,
  getActivePlayerCount,
  runOutAndFinish,
  moveToNextStreetCore,
  determineWinnerCore,
} from '../core.js';

export function isBettingStreet(street: Street): boolean {
  return street === 'predraw' || street === 'postdraw1' || street === 'postdraw2' || street === 'final';
}

export function getDrawStreetOrder(maxDraws: number): Street[] {
  // maxDraws=1: predraw → draw1 → final → showdown
  // maxDraws=2: predraw → draw1 → postdraw1 → draw2 → final → showdown
  // maxDraws=3: predraw → draw1 → postdraw1 → draw2 → postdraw2 → draw3 → final → showdown
  const streets: Street[] = ['predraw'];
  const drawNames: Street[] = ['draw1', 'draw2', 'draw3'];
  const postDrawNames: Street[] = ['postdraw1', 'postdraw2'];
  for (let i = 0; i < maxDraws; i++) {
    streets.push(drawNames[i]);
    // ドロー後のベッティングラウンド（最後のドロー以外）
    if (i < maxDraws - 1 && i < postDrawNames.length) {
      streets.push(postDrawNames[i]);
    }
  }
  streets.push('final', 'showdown');
  return streets;
}

function getNextDrawStreet(current: Street, maxDraws: number): Street {
  const order = getDrawStreetOrder(maxDraws);
  const currentIdx = order.indexOf(current);
  if (currentIdx === -1 || currentIdx >= order.length - 1) return 'showdown';
  return order[currentIdx + 1];
}

/** Triple Draw: predraw & postdraw1 = small bet, それ以降 = big bet */
function drawBetSize(state: GameState): number {
  if (state.currentStreet === 'predraw' || state.currentStreet === 'postdraw1') {
    return state.smallBlind;
  }
  return state.bigBlind;
}

function reshuffleDiscardPile(state: GameState): void {
  if (!state.discardPile || state.discardPile.length === 0) return;
  const reshuffled = shuffleDeck([...state.discardPile]);
  state.deck = [...state.deck, ...reshuffled];
  state.discardPile = [];
}

/** ドローフェーズの次アクター（オールインでもカード交換するため hasActed のみで判定） */
function determineDrawNextAction(state: GameState): { nextPlayerIndex: number; moveToNextStreet: boolean } {
  const activePlayers = getActivePlayers(state);

  if (activePlayers.length === 1) {
    return { nextPlayerIndex: -1, moveToNextStreet: false };
  }

  let index = (state.currentPlayerIndex + 1) % MAX_PLAYERS;
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = state.players[index];
    if (!p.folded && !p.isSittingOut && !p.hasActed) {
      return { nextPlayerIndex: index, moveToNextStreet: false };
    }
    index = (index + 1) % MAX_PLAYERS;
  }

  // 全員ドロー済み → 次のストリートへ
  return { nextPlayerIndex: -1, moveToNextStreet: true };
}

function makeDrawDescriptor(opts: { betting: BettingRules; noLimit: boolean }): VariantDescriptor {
  const descriptor: VariantDescriptor = {
    resetHand(state) {
      state.currentStreet = 'predraw';
      state.betCount = 0;
      state.discardPile = [];
    },

    setup(state) {
      const activeCount = getActivePlayerCount(state);

      const { sbIndex, bbIndex } = findBlindSeats(state, activeCount);
      assignBlindPostingPositions(state, state.dealerPosition, sbIndex, bbIndex, activeCount, MAX_PLAYERS);

      const sbAmount = postBlind(state, sbIndex, state.smallBlind);
      const bbAmount = postBlind(state, bbIndex, state.bigBlind);

      // === BBアンティ（state.ante > 0 のときのみ。NL 2-7 Single Draw 等）===
      // BB席がテーブル分のアンティをデッドマネーとして投入する（BBアンティ方式）。
      // ライブベット(currentBet/totalBetThisRound)には含めず、ショーダウンで
      // メインポットへ加算する（buildPots 側で処理）。
      // BBがブラインドすら賄えずオールインの場合（chips===0）はアンテ無し。
      const bbPlayer = state.players[bbIndex];
      const anteAmount = state.ante > 0 ? Math.min(state.ante, bbPlayer.chips) : 0;
      if (anteAmount > 0) {
        bbPlayer.chips -= anteAmount;
        if (bbPlayer.chips === 0) bbPlayer.isAllIn = true;
      }

      state.pot = sbAmount + bbAmount + anteAmount;
      state.currentBet = state.bigBlind;
      state.minRaise = opts.noLimit ? state.bigBlind : state.smallBlind;
      state.lastFullRaiseBet = state.currentBet;

      // === カード配布: 各プレイヤーに5枚 ===
      dealHoleCardsToAll(state, 5);

      state.currentPlayerIndex = preflopFirstActor(state, activeCount, sbIndex, bbIndex);
      state.lastRaiserIndex = bbIndex;

      if (state.currentPlayerIndex === -1) {
        return runOutAndFinish(state, descriptor);
      }

      return state;
    },

    betting: opts.betting,

    flow: {
      nextStreet(state) {
        return getNextDrawStreet(state.currentStreet, state.maxDraws ?? 3);
      },
      onEnterStreet() {
        // ドロー系はストリート進行でカードを配らない（ドローはプレイヤーアクション）
      },
      firstToAct(state) {
        // ドローフェーズはオールインでもカード交換を行うため対象に含める
        return findFirstActorFromSb(state, isDrawStreet(state.currentStreet));
      },
      whenBettingImpossible: 'skipStreet',
      runOutDealsBeforeShowdown: false,
      runOut() {
        // 配りきるカードはない（ショーダウンは手札5枚のまま）
      },
    },

    showdown: {
      noDropStreet: 'predraw',
      rakeCapBase: (state) => state.bigBlind,

      buildPots(state) {
        const allPots = calculateSidePots(state.players);

        // デッドマネー（BBアンティ等、ライブベットに含まれない投入）をメインポットへ加算する。
        // calculateSidePots は totalBetThisRound ベースなのでアンティ分が欠落する。
        // 差分をショーダウンに残った全員が争うメインポット(=最低レベル=allPots[0])へ載せる。
        const totalContributed = state.players.reduce((s, p) => s + p.totalBetThisRound, 0);
        const deadMoney = state.pot - totalContributed;
        if (deadMoney > 0 && allPots.length > 0) {
          allPots[0].amount += deadMoney;
        }

        return settleUncontestedPots(state, allPots);
      },

      resolvePots(_state, activePlayers, pots) {
        // 2-7 ローボール評価（ドロー途中の5枚未満は評価対象外）
        const hands = new Map<number, ReturnType<typeof evaluate27LowHand>>();
        for (const p of activePlayers) {
          if (p.holeCards.length === 5) {
            hands.set(p.id, evaluate27LowHand(p.holeCards));
          }
        }
        return resolvePotsByBestHand(pots, hands, compare27LowHands, formatHandName, 1);
      },
    },

    drawPhase: {
      apply(state, playerIndex, discardIndices, d) {
        const player = state.players[playerIndex];

        // バリデーション: 重複除去、範囲チェック、降順ソート（後ろから削除）
        const uniqueIndices = [...new Set(discardIndices)]
          .filter(i => i >= 0 && i < player.holeCards.length)
          .sort((a, b) => b - a);

        // 捨てるカードをdiscardPileに移動
        const discardedCards: Card[] = [];
        for (const idx of uniqueIndices) {
          discardedCards.push(player.holeCards[idx]);
          player.holeCards.splice(idx, 1);
        }
        if (!state.discardPile) state.discardPile = [];
        state.discardPile.push(...discardedCards);

        // 新しいカードを引く
        const needCards = discardedCards.length;
        if (needCards > 0) {
          if (state.deck.length < needCards) {
            reshuffleDiscardPile(state);
          }
          const drawCount = Math.min(needCards, state.deck.length);
          const { cards, remainingDeck } = dealCards(state.deck, drawCount);
          player.holeCards.push(...cards);
          state.deck = remainingDeck;
        }

        state.handHistory.push({
          playerId: playerIndex,
          action: 'draw',
          amount: discardedCards.length,
          street: state.currentStreet,
          discardIndices: uniqueIndices.sort((a, b) => a - b),
        });

        // 次のプレイヤー or 次のストリート
        // （ドロー経路は従来通りレーキパラメータを引き回さない = レーキ0で解決する）
        const nextResult = determineDrawNextAction(state);
        if (nextResult.moveToNextStreet) {
          return moveToNextStreetCore(state, d);
        } else if (nextResult.nextPlayerIndex !== -1) {
          state.currentPlayerIndex = nextResult.nextPlayerIndex;
          return state;
        }
        return determineWinnerCore(state, d);
      },
    },

    createTableState(variant, buyInChips, smallBlind, bigBlind, ante) {
      const maxDraws = opts.noLimit ? 1 : 3;
      const state = createDrawBaseState(buyInChips, smallBlind, maxDraws);
      // No-Limit Single Draw は実ブラインド (SB/BB) をそのまま使うため、
      // ブラインド表の bigBlind を反映する（Fixed-Limit は smallBlind/bigBlind を
      // small bet/big bet のラダー (big bet = SB×2) として使うため上書きしない）。
      if (opts.noLimit) {
        state.bigBlind = bigBlind;
      }
      // BBアンティ: ブラインド表に ante があれば反映（NL Single Draw のトナメ等）。
      state.ante = ante;
      return state;
    },
  };
  return descriptor;
}

/** Draw 用の初期 GameState（シムの createDrawGameState と共用） */
export function createDrawBaseState(playerChips: number, smallBet: number, maxDraws: number): GameState {
  return buildBaseGameState({
    playerChips,
    currentStreet: 'predraw',
    minRaise: smallBet,
    smallBlind: smallBet,
    bigBlind: smallBet * 2,
    variant: (maxDraws === 1 ? 'no_limit_2-7_single_draw' : 'limit_2-7_triple_draw') as GameVariant,
    maxBetsPerRound: 4,
    extra: { discardPile: [], maxDraws },
  });
}

export const drawNoLimitDescriptor = makeDrawDescriptor({ betting: noLimitBetting(), noLimit: true });
export const drawFixedLimitDescriptor = makeDrawDescriptor({ betting: drawFixedLimitBetting(drawBetSize), noLimit: false });

/** Single Draw (maxDraws=1) は No-Limit、それ以外は Fixed Limit */
export function drawDescriptorFor(state: GameState): VariantDescriptor {
  return (state.maxDraws ?? 3) === 1 ? drawNoLimitDescriptor : drawFixedLimitDescriptor;
}
