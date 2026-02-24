import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import type { PlayerStats } from './computeStats.js';

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };

    const cache = await prisma.playerStatsCache.findUnique({
      where: { userId },
    });

    if (!cache || cache.handsPlayed === 0) {
      return { stats: null, handsAnalyzed: 0 };
    }

    const pct = (num: number, denom: number) => denom > 0 ? (num / denom) * 100 : 0;

    const stats: PlayerStats = {
      handsPlayed: cache.handsPlayed,
      winRate: pct(cache.winCount, cache.handsPlayed),
      totalProfit: cache.totalProfit,
      totalAllInEVProfit: cache.totalAllInEVProfit,
      vpip: pct(cache.vpipCount, cache.detailedHands),
      pfr: pct(cache.pfrCount, cache.detailedHands),
      threeBet: pct(cache.threeBetCount, cache.threeBetOpportunity),
      afq: pct(cache.aggressiveActions, cache.totalPostflopActions),
      cbet: pct(cache.cbetCount, cache.cbetOpportunity),
      foldToCbet: pct(cache.foldToCbetCount, cache.facedCbetCount),
      foldTo3Bet: pct(cache.foldTo3BetCount, cache.faced3BetCount),
      wtsd: pct(cache.wtsdCount, cache.sawFlopCount),
      wsd: pct(cache.wsdCount, cache.wtsdCount),
    };

    return { stats, handsAnalyzed: cache.handsPlayed };
  });

  // 収支推移データ（グラフ用）
  fastify.get('/:userId/profit-history', async (request: FastifyRequest) => {
    const { userId } = request.params as { userId: string };

    const rows = await prisma.handHistoryPlayer.findMany({
      where: { userId },
      orderBy: { handHistory: { createdAt: 'asc' } },
      select: { profit: true, finalHand: true, allInEVProfit: true },
    });

    let cumTotal = 0;
    let cumSD = 0;
    let cumNoSD = 0;
    let cumEV = 0;
    const points = rows.map(r => {
      const sd = r.finalHand != null;
      cumTotal += r.profit;
      cumEV += r.allInEVProfit ?? r.profit;
      if (sd) cumSD += r.profit; else cumNoSD += r.profit;
      return { p: r.profit, c: cumTotal, s: cumSD, n: cumNoSD, e: cumEV };
    });

    return { points };
  });
}
