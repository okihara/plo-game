import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { maskName } from '../../shared/utils.js';
import { renderOgpImage } from './renderOgpImage.js';

export async function ogpRoutes(fastify: FastifyInstance) {
  // OGP画像生成: GET /api/ogp/player/:userId
  fastify.get('/player/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };

    const [cache, user, historyRows] = await Promise.all([
      prisma.playerStatsCache.findUnique({ where: { userId } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true, nameMasked: true },
      }),
      prisma.handHistoryPlayer.findMany({
        where: { userId },
        orderBy: { handHistory: { createdAt: 'asc' } },
        select: { profit: true, finalHand: true, allInEVProfit: true },
      }),
    ]);

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const displayName = user.displayName
      ? user.displayName
      : user.nameMasked
        ? maskName(user.username)
        : user.username;

    const pct = (num: number, denom: number) => denom > 0 ? (num / denom) * 100 : 0;

    const stats = cache && cache.handsPlayed > 0
      ? {
          handsPlayed: cache.handsPlayed,
          totalProfit: cache.totalProfit,
          winRate: cache.totalProfit / cache.handsPlayed,
          totalAllInEVProfit: cache.totalAllInEVProfit,
          evWinRate: cache.totalAllInEVProfit / cache.handsPlayed,
          vpip: pct(cache.vpipCount, cache.detailedHands),
          pfr: pct(cache.pfrCount, cache.detailedHands),
          threeBet: pct(cache.threeBetCount, cache.threeBetOpportunity),
          afq: pct(cache.aggressiveActions, cache.totalPostflopActions),
          cbet: pct(cache.cbetCount, cache.cbetOpportunity),
          foldToCbet: pct(cache.foldToCbetCount, cache.facedCbetCount),
          foldTo3Bet: pct(cache.foldTo3BetCount, cache.faced3BetCount),
        }
      : null;

    // 収支推移データ
    let profitPoints: { c: number; e: number; s: number; n: number }[] | null = null;
    if (historyRows.length >= 2) {
      const cacheEvDiff = cache ? cache.totalAllInEVProfit - cache.totalProfit : 0;
      let cumTotal = 0;
      let cumEV = 0;
      let cumSD = 0;
      let cumNoSD = 0;
      profitPoints = historyRows.map(r => {
        const sd = r.finalHand != null;
        cumTotal += r.profit;
        cumEV += r.allInEVProfit ?? r.profit;
        if (sd) cumSD += r.profit; else cumNoSD += r.profit;
        return { c: cumTotal, e: cumEV, s: cumSD, n: cumNoSD };
      });
      // allInEVProfit が全てNULLの場合、キャッシュの差分で補正
      if (cumEV === cumTotal && cacheEvDiff !== 0) {
        for (let i = 0; i < profitPoints.length; i++) {
          profitPoints[i].e = Math.round(profitPoints[i].c + cacheEvDiff * ((i + 1) / profitPoints.length));
        }
      }
    }

    const png = await renderOgpImage(displayName, stats, profitPoints);

    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=300, s-maxage=300');
    return reply.send(png);
  });
}
