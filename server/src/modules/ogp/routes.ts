import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { maskName, verifyShareToken } from '../../shared/utils.js';
import { env } from '../../config/env.js';
import { renderOgpImage } from './renderOgpImage.js';
import { renderHandOgpImage, getPositionName } from './renderHandOgpImage.js';

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

  // OGP画像生成: GET /api/ogp/hand/:handId
  fastify.get('/hand/:handId', async (request: FastifyRequest, reply) => {
    const { handId } = request.params as { handId: string };
    const token = (request.query as Record<string, string>).t || '';
    const revealedSeat = verifyShareToken(handId, token, env.JWT_SECRET);

    const hand = await prisma.handHistory.findUnique({
      where: { id: handId },
      include: {
        players: {
          select: {
            username: true,
            seatPosition: true,
            holeCards: true,
            finalHand: true,
            profit: true,
            user: {
              select: { displayName: true, nameMasked: true },
            },
          },
        },
      },
    });

    if (!hand) {
      return reply.status(404).send({ error: 'Hand not found' });
    }

    const allSeats = hand.players.map(p => p.seatPosition);

    const players = hand.players.map(p => {
      const rawName = p.username || `Seat ${p.seatPosition + 1}`;
      const isRevealed = p.seatPosition === revealedSeat;
      const displayName = isRevealed
        ? (p.user?.displayName || rawName)
        : maskName(rawName);

      return {
        username: displayName,
        seatPosition: p.seatPosition,
        holeCards: p.holeCards,
        finalHand: p.finalHand,
        profit: p.profit,
        position: getPositionName(p.seatPosition, hand.dealerPosition, allSeats),
      };
    });

    // アクション情報をプレイヤー名で変換
    const seatNameMap = new Map(players.map(p => [p.seatPosition, p]));
    const actions = (hand.actions as { seatIndex: number; action: string; amount: number; street?: string }[]).map(a => ({
      position: seatNameMap.get(a.seatIndex)?.position || '',
      playerName: seatNameMap.get(a.seatIndex)?.username || '',
      action: a.action,
      amount: a.amount,
      street: a.street,
    }));

    const png = await renderHandOgpImage({
      handId: hand.id,
      blinds: hand.blinds,
      communityCards: hand.communityCards,
      potSize: hand.potSize,
      rakeAmount: hand.rakeAmount,
      players,
      actions,
      dealerPosition: hand.dealerPosition,
      createdAt: hand.createdAt.toISOString(),
    });

    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'public, max-age=3600, s-maxage=3600');
    return reply.send(png);
  });
}
