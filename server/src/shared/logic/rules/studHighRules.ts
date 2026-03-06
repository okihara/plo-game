import { GameState, Card, Suit, getUpCards } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluateStudHand, evaluateShowingHand, compareHands } from '../handEvaluator.js';
import { StudVariantRules, ShowdownPlayer, ShowdownPot, PotWinner } from '../studVariantRules.js';

const MAX_PLAYERS = 6;

// スートの強さ（ブリングイン判定用: ♣ < ♦ < ♥ < ♠）
const SUIT_VALUE: Record<Suit, number> = { c: 1, d: 2, h: 3, s: 4 };

export class StudHighRules implements StudVariantRules {
  /** 最低ドアカードのプレイヤーがブリングイン */
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

  /** 最高ショウイングハンドのプレイヤーが先行アクション */
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

  describeHand(cards: Card[]): string {
    if (cards.length >= 5) {
      return evaluateStudHand(cards).name;
    }
    return '';
  }

  /** ハイハンド勝利: 各ポットで最高ハンドが総取り */
  resolveShowdown(activePlayers: ShowdownPlayer[], pots: ShowdownPot[]): PotWinner[] {
    const playerHandMap = new Map<number, ReturnType<typeof evaluateStudHand>>();
    for (const player of activePlayers) {
      playerHandMap.set(player.id, evaluateStudHand(player.holeCards));
    }

    const winnerAmounts = new Map<number, { amount: number; handName: string }>();

    for (const pot of pots) {
      const eligibleHands = pot.eligiblePlayers
        .filter(id => playerHandMap.has(id))
        .map(id => ({ playerId: id, hand: playerHandMap.get(id)! }));

      if (eligibleHands.length === 0) continue;

      eligibleHands.sort((a, b) => compareHands(b.hand, a.hand));

      const potWinners = [eligibleHands[0]];
      for (let i = 1; i < eligibleHands.length; i++) {
        if (compareHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
          potWinners.push(eligibleHands[i]);
        } else {
          break;
        }
      }

      const winAmount = Math.floor(pot.amount / potWinners.length);
      const remainder = pot.amount % potWinners.length;

      for (let i = 0; i < potWinners.length; i++) {
        const amount = winAmount + (i === 0 ? remainder : 0);
        const existing = winnerAmounts.get(potWinners[i].playerId);
        if (existing) {
          existing.amount += amount;
        } else {
          winnerAmounts.set(potWinners[i].playerId, {
            amount,
            handName: potWinners[i].hand.name,
          });
        }
      }
    }

    return Array.from(winnerAmounts.entries()).map(([playerId, { amount, handName }]) => ({
      playerId,
      amount,
      handName,
    }));
  }
}
