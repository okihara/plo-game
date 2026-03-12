import { GameState, Card, Suit, getUpCards } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluateStudHand, evaluateShowingHand, compareHands } from '../handEvaluator.js';
import { StudVariantRules, ShowdownPlayer, ShowdownPot, PotWinner } from '../studVariantRules.js';
import { resolveHiLoShowdown, HiLoPotWinner } from '../hiLoSplitPot.js';
import { evaluateStudHiLoHand } from '../handEvaluator.js';

const MAX_PLAYERS = 6;

// ブリングイン判定: 最低ドアカード（Stud Highと同じ）
const SUIT_VALUE: Record<Suit, number> = { c: 1, d: 2, h: 3, s: 4 };

export class StudHiLoRules implements StudVariantRules {
  /** 最低ドアカードのプレイヤーがブリングイン（Stud Highと同じ） */
  findBringInPlayer(state: GameState): number {
    let lowestIndex = -1;
    let lowestRank = Infinity;
    let lowestSuit = Infinity;

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = state.players[i];
      const upCards = getUpCards(p.holeCards);
      if (p.isSittingOut || p.folded || upCards.length === 0) continue;

      const doorCard = upCards[0];
      const rankVal = getRankValue(doorCard.rank);
      const suitVal = SUIT_VALUE[doorCard.suit];

      if (rankVal < lowestRank || (rankVal === lowestRank && suitVal < lowestSuit)) {
        lowestRank = rankVal;
        lowestSuit = suitVal;
        lowestIndex = i;
      }
    }

    return lowestIndex;
  }

  /** 最高ショウイングハンドのプレイヤーが先行アクション（Stud Highと同じ） */
  findFirstToAct(state: GameState): number {
    let bestIndex = -1;
    let bestHand = { rank: 0, name: '', highCards: [] as number[] };

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = state.players[i];
      if (p.isSittingOut || p.folded || p.isAllIn) continue;

      const hand = evaluateShowingHand(getUpCards(p.holeCards));
      if (compareHands(hand, bestHand) > 0) {
        bestHand = hand;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  /** ハンド名: ハイ名 + ロー名（あれば） */
  describeHand(cards: Card[]): string {
    if (cards.length >= 5) {
      const { high, low } = evaluateStudHiLoHand(cards);
      return low ? `${high.name} / ${low.name}` : high.name;
    }
    return '';
  }

  /** Hi-Lo ショーダウン: ハイとローでポットをスプリット */
  resolveShowdown(activePlayers: ShowdownPlayer[], pots: ShowdownPot[]): PotWinner[] {
    const hiLoWinners: HiLoPotWinner[] = resolveHiLoShowdown(
      activePlayers,
      pots,
      (player) => evaluateStudHiLoHand(player.holeCards),
    );

    // PotWinner[] に変換（hiLoType は PotWinner には無いが、GameState.winnersで使う）
    return hiLoWinners.map(w => ({
      playerId: w.playerId,
      amount: w.amount,
      handName: w.handName,
      hiLoType: w.hiLoType,
    }));
  }
}
