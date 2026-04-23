// ハンド完了時にプレイヤースタッツをインクリメンタル更新

import { prisma } from '../../config/database.js';
import { GameState } from '../../shared/logic/types.js';
import { SeatInfo } from '../table/types.js';
import { computeIncrementForPlayer } from './statsComputation.js';
import { checkHandCountBadges, /* checkWinCountBadges, */ checkBadBeatBadges } from '../badges/badgeService.js';
import { evaluatePLOHand } from '../../shared/logic/handEvaluator.js';

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
  isTournament: boolean = false,
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

    const updateData = {
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
    };
    const upsertArgs = {
      where: { userId: seat.odId },
      create: { userId: seat.odId, ...inc },
      update: updateData,
    };
    upserts.push(
      isTournament
        ? prisma.tournamentStatsCache.upsert(upsertArgs)
        : prisma.playerStatsCache.upsert(upsertArgs)
    );
  }

  const results = await Promise.all(upserts);

  // バッジはキャッシュゲームのみでトラッキング
  if (isTournament) return;

  // バッジチェック (fire-and-forget)
  for (const result of results) {
    const cache = result as { userId: string; handsPlayed: number; winCount: number };
    checkHandCountBadges(cache.userId, cache.handsPlayed).catch(err =>
      console.error('Badge check failed:', err)
    );
    // checkWinCountBadges(cache.userId, cache.winCount).catch(err =>
    //   console.error('Win badge check failed:', err)
    // );
  }

  // バッドビートチェック (fire-and-forget)
  // ショーダウンに進んだハンドのみ（コミュニティカード5枚 & 勝者にhandNameあり）
  const isShowdown = gameState.communityCards.length === 5 &&
    gameState.winners.some(w => w.handName);
  if (isShowdown) {
    try {
      // 勝者のハンドランクを取得
      const winnerSeatIndices = new Set(gameState.winners.map(w => w.playerId));
      const winnerHandRanks: number[] = [];
      for (const w of gameState.winners) {
        const player = gameState.players[w.playerId];
        if (player.holeCards.length >= 4) {
          const hand = evaluatePLOHand(player.holeCards, gameState.communityCards);
          winnerHandRanks.push(hand.rank);
        }
      }

      // 負けたプレイヤー（ショーダウン参加 = フォールドしていない & 勝者でない）
      const losers: { odId: string; handRank: number }[] = [];
      for (let i = 0; i < seats.length; i++) {
        const seat = seats[i];
        const player = gameState.players[i];
        if (!seat || !startChips.has(i) || winnerSeatIndices.has(i)) continue;
        if (player.folded || player.holeCards.length < 4) continue;

        try {
          const hand = evaluatePLOHand(player.holeCards, gameState.communityCards);
          losers.push({ odId: seat.odId, handRank: hand.rank });
        } catch {
          // ハンド評価失敗はスキップ
        }
      }

      if (losers.length > 0 && winnerHandRanks.length > 0) {
        checkBadBeatBadges(losers, winnerHandRanks).catch(err =>
          console.error('Bad beat badge check failed:', err)
        );
      }
    } catch (err) {
      console.error('Bad beat detection failed:', err);
    }
  }
}
