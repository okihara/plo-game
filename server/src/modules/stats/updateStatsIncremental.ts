// ハンド完了時にプレイヤースタッツをインクリメンタル更新

import { prisma } from '../../config/database.js';
import { GameState } from '../../shared/logic/types.js';
import { SeatInfo } from '../table/types.js';
import { computeIncrementForPlayer } from './statsComputation.js';

export { computeIncrementForPlayer } from './statsComputation.js';

function isAuthenticatedUser(_odId: string): boolean {
  return true;
}

/** ハンド完了時に全認証済みプレイヤーのスタッツキャッシュを更新 */
export async function updatePlayerStats(
  gameState: GameState,
  seats: (SeatInfo | null)[],
  startChips: Map<number, number>,
  allInEVProfits?: Map<number, number> | null,
): Promise<void> {
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
        !player.folded && player.holeCards.length === 4 && gameState.communityCards.length === 5
          ? 'evaluated' // showdown参加マーカー
          : null
      );
      playerInfos.push({ odId: seat.odId, seatPosition: i, finalHand });
    }
  }

  const upserts: Promise<unknown>[] = [];

  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i];
    if (!seat || !startChips.has(i) || !isAuthenticatedUser(seat.odId)) continue;

    const profit = gameState.players[i].chips - startChips.get(i)!;
    const allInEVProfit = allInEVProfits?.get(i) ?? null;
    const inc = computeIncrementForPlayer(
      seat.odId, i, profit, actions,
      gameState.dealerPosition, winnerOdIds,
      activeSeatPositions, gameState.communityCards.length,
      playerInfos, allInEVProfit,
    );

    upserts.push(
      prisma.playerStatsCache.upsert({
        where: { userId: seat.odId },
        create: { userId: seat.odId, ...inc },
        update: {
          handsPlayed: { increment: inc.handsPlayed },
          winCount: { increment: inc.winCount },
          totalProfit: { increment: inc.totalProfit },
          totalAllInEVProfit: { increment: inc.totalAllInEVProfit },
          detailedHands: { increment: inc.detailedHands },
          vpipCount: { increment: inc.vpipCount },
          pfrCount: { increment: inc.pfrCount },
          threeBetCount: { increment: inc.threeBetCount },
          threeBetOpportunity: { increment: inc.threeBetOpportunity },
          foldTo3BetCount: { increment: inc.foldTo3BetCount },
          faced3BetCount: { increment: inc.faced3BetCount },
          fourBetCount: { increment: inc.fourBetCount },
          fourBetOpportunity: { increment: inc.fourBetOpportunity },
          aggressiveActions: { increment: inc.aggressiveActions },
          totalPostflopActions: { increment: inc.totalPostflopActions },
          cbetCount: { increment: inc.cbetCount },
          cbetOpportunity: { increment: inc.cbetOpportunity },
          foldToCbetCount: { increment: inc.foldToCbetCount },
          facedCbetCount: { increment: inc.facedCbetCount },
          sawFlopCount: { increment: inc.sawFlopCount },
          wtsdCount: { increment: inc.wtsdCount },
          wsdCount: { increment: inc.wsdCount },
        },
      })
    );
  }

  await Promise.all(upserts);
}
