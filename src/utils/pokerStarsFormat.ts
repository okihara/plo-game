import type { HandDetail } from '../components/HandDetailDialog';
import { toPokerStarsHandText, type PokerStarsHandInput } from '@plo/shared';

export function toPokerStarsText(hand: HandDetail): string {
  // 5 枚ホールカードのプレイヤーがいれば PLO5 と判定 (DB スキーマに gameVariant
  // カラムが追加されたら hand.gameVariant を直接使う形に置換予定)
  const variant = hand.players.some(p => p.holeCards.length === 5) ? 'plo5' : 'plo';
  const input: PokerStarsHandInput = {
    id: hand.id,
    handNumber: hand.handNumber,
    blinds: hand.blinds,
    communityCards: hand.communityCards,
    potSize: hand.potSize,
    rakeAmount: hand.rakeAmount,
    winners: hand.winners,
    actions: hand.actions,
    dealerPosition: hand.dealerPosition,
    createdAt: hand.createdAt,
    players: hand.players.map(p => ({
      username: p.username,
      seatPosition: p.seatPosition,
      startChips: p.startChips,
      holeCards: p.holeCards,
      finalHand: p.finalHand,
      profit: p.profit,
      isCurrentUser: p.isCurrentUser,
    })),
    variant,
  };
  return toPokerStarsHandText(input);
}
