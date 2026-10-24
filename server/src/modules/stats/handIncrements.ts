// 完了ハンド（GameState + 席情報）から席ごとのスタッツ増分を組み立てる（DB依存なし）

import { GameState } from '../../shared/logic/types.js';
import { SeatInfo } from '../table/types.js';
import { computeIncrementForPlayer, StatsIncrement } from './statsComputation.js';

export interface SeatIncrement {
  seatIndex: number;
  odId: string;
  inc: StatsIncrement;
}

/** ハンド開始時に着席していた（startChips を持つ）全員分の増分を返す */
export function computeHandIncrements(
  gameState: GameState,
  seats: (SeatInfo | null)[],
  startChips: Map<number, number>,
  allInEVProfits?: Map<number, number> | null,
): SeatIncrement[] {
  const actions = gameState.handHistory.map(a => ({
    seatIndex: a.playerId,
    odId: seats[a.playerId]?.odId ?? `unknown_${a.playerId}`,
    action: a.action,
    amount: a.amount,
    street: a.street,
  }));

  const winnerOdIds = gameState.winners
    .map(w => seats[w.playerId]?.odId ?? '')
    .filter(Boolean);

  const activeSeatPositions: number[] = [];
  const playerInfos: { odId: string; seatPosition: number; finalHand: string | null }[] = [];

  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i];
    if (seat && startChips.has(i)) {
      activeSeatPositions.push(i);
      const winner = gameState.winners.find(w => w.playerId === i);
      const player = gameState.players[i];
      const finalHand = winner?.handName ?? (
        !player.folded && (player.holeCards.length === 4 || player.holeCards.length === 5) && gameState.communityCards.length === 5
          ? 'evaluated' // showdown参加マーカー
          : null
      );
      playerInfos.push({ odId: seat.odId, seatPosition: i, finalHand });
    }
  }

  const result: SeatIncrement[] = [];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i];
    if (!seat || !startChips.has(i)) continue;

    const profit = gameState.players[i].chips - startChips.get(i)!;
    const allInEVProfit = allInEVProfits?.get(i) ?? null;
    const inc = computeIncrementForPlayer(
      seat.odId, i, profit, actions,
      gameState.dealerPosition, winnerOdIds,
      activeSeatPositions, gameState.communityCards.length,
      playerInfos, allInEVProfit,
    );
    result.push({ seatIndex: i, odId: seat.odId, inc });
  }
  return result;
}
