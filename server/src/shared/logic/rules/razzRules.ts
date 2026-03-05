import { GameState, Card, Suit, getUpCards } from '../types.js';
import { getRankValue } from '../deck.js';
import { evaluateRazzHand, evaluateRazzShowingHand, compareLowHands } from '../handEvaluator.js';
import { StudVariantRules, ShowdownPlayer, ShowdownPot, PotWinner } from '../studVariantRules.js';

const MAX_PLAYERS = 6;

// Razz のブリングインはスートが高い方: ♠ > ♥ > ♦ > ♣
const SUIT_VALUE: Record<Suit, number> = { c: 1, d: 2, h: 3, s: 4 };

export class RazzRules implements StudVariantRules {
  /** 最高ドアカードのプレイヤーがブリングイン（Studの逆） */
  findBringInPlayer(state: GameState): number {
    let highestIndex = -1;
    let highestRank = -1;
    let highestSuit = -1;

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = state.players[i];
      const upCards = getUpCards(p.holeCards);
      if (p.isSittingOut || p.folded || upCards.length === 0) continue;

      const doorCard = upCards[0];
      const rankVal = getRankValue(doorCard.rank);
      const suitVal = SUIT_VALUE[doorCard.suit];

      // 高いランクが優先、同ランクなら高いスート（♠が最高）
      if (rankVal > highestRank || (rankVal === highestRank && suitVal > highestSuit)) {
        highestRank = rankVal;
        highestSuit = suitVal;
        highestIndex = i;
      }
    }

    return highestIndex;
  }

  /** 最低ショウイングハンドのプレイヤーが先行アクション（Studの逆） */
  findFirstToAct(state: GameState): number {
    let bestIndex = -1;
    let bestLow: { rank: number; name: string; highCards: number[] } | null = null;

    for (let i = 0; i < MAX_PLAYERS; i++) {
      const p = state.players[i];
      if (p.isSittingOut || p.folded || p.isAllIn) continue;

      const hand = evaluateRazzShowingHand(getUpCards(p.holeCards));
      if (!bestLow || compareLowHands(hand, bestLow) < 0) {
        bestLow = hand;
        bestIndex = i;
      }
    }

    return bestIndex;
  }

  describeHand(cards: Card[]): string {
    if (cards.length >= 5) {
      return evaluateRazzHand(cards).name;
    }
    return '';
  }

  /** ローハンド勝利: 各ポットで最低ハンドが総取り */
  resolveShowdown(activePlayers: ShowdownPlayer[], pots: ShowdownPot[]): PotWinner[] {
    const playerHandMap = new Map<number, ReturnType<typeof evaluateRazzHand>>();
    for (const player of activePlayers) {
      playerHandMap.set(player.id, evaluateRazzHand(player.holeCards));
    }

    const winnerAmounts = new Map<number, { amount: number; handName: string }>();

    for (const pot of pots) {
      const eligibleHands = pot.eligiblePlayers
        .filter(id => playerHandMap.has(id))
        .map(id => ({ playerId: id, hand: playerHandMap.get(id)! }));

      if (eligibleHands.length === 0) continue;

      // ロー: compareLowHands で昇順ソート（低い=良い が先頭）
      eligibleHands.sort((a, b) => compareLowHands(a.hand, b.hand));

      const potWinners = [eligibleHands[0]];
      for (let i = 1; i < eligibleHands.length; i++) {
        if (compareLowHands(eligibleHands[i].hand, eligibleHands[0].hand) === 0) {
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
