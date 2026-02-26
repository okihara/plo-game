import { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import type { PlayerStats } from './computeStats.js';
import { maskName } from '../../shared/utils.js';

// ランキングキャッシュ（60秒TTL）
const rankingsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

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
      winRate: cache.handsPlayed > 0 ? cache.totalProfit / cache.handsPlayed : 0,
      totalProfit: cache.totalProfit,
      totalAllInEVProfit: cache.totalAllInEVProfit,
      vpip: pct(cache.vpipCount, cache.detailedHands),
      pfr: pct(cache.pfrCount, cache.detailedHands),
      threeBet: pct(cache.threeBetCount, cache.threeBetOpportunity),
      fourBet: pct(cache.fourBetCount, cache.fourBetOpportunity),
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

    const [rows, cache] = await Promise.all([
      prisma.handHistoryPlayer.findMany({
        where: { userId },
        orderBy: { handHistory: { createdAt: 'asc' } },
        select: { profit: true, finalHand: true, allInEVProfit: true },
      }),
      prisma.playerStatsCache.findUnique({
        where: { userId },
        select: { totalProfit: true, totalAllInEVProfit: true },
      }),
    ]);

    // スタッツキャッシュからEV補正値を計算
    // DB の allInEVProfit はほとんど NULL のため、キャッシュの差分を使って補正する
    const cacheEvDiff = cache ? cache.totalAllInEVProfit - cache.totalProfit : 0;

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

    // allInEVProfit が全てNULLの場合(cumEV === cumTotal)、キャッシュの差分で補正
    if (points.length > 0 && cumEV === cumTotal && cacheEvDiff !== 0) {
      // EV差分をハンド位置に比例して段階的に適用
      for (let i = 0; i < points.length; i++) {
        points[i].e = Math.round(points[i].c + cacheEvDiff * ((i + 1) / points.length));
      }
    }

    return { points };
  });

  // ランキング（全プレイヤー）— period: all | weekly | daily
  fastify.get('/rankings', async (request: FastifyRequest) => {
    const { period = 'all' } = request.query as { period?: string };
    const MIN_HANDS = 10;

    // キャッシュチェック（60秒TTL）
    const cacheKey = `rankings:${period}`;
    const cached = rankingsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    let result: { rankings: unknown[] };

    if (period === 'all') {
      // 全期間: PlayerStatsCacheから取得（高速）
      const caches = await prisma.playerStatsCache.findMany({
        where: {
          handsPlayed: { gte: MIN_HANDS },
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
              nameMasked: true,
              useTwitterAvatar: true,
              provider: true,
            },
          },
        },
      });

      result = {
        rankings: caches.map(cache => ({
          userId: cache.userId,
          username: cache.user.nameMasked ? maskName(cache.user.username) : cache.user.username,
          avatarUrl: cache.user.useTwitterAvatar ? (cache.user.avatarUrl ?? null) : null,
          isBot: cache.user.provider === 'bot',
          handsPlayed: cache.handsPlayed,
          totalAllInEVProfit: cache.totalAllInEVProfit,
          winCount: cache.winCount,
        })),
      };
    } else {
      // daily / weekly: Raw SQLでDB側集計
      const now = new Date();
      const startDate = new Date(now);
      if (period === 'daily') {
        startDate.setHours(0, 0, 0, 0);
      } else {
        // 今週の月曜 00:00（月曜始まり）
        const day = startDate.getDay(); // 0=日, 1=月, ..., 6=土
        const diff = day === 0 ? 6 : day - 1; // 日曜は6日前の月曜
        startDate.setDate(startDate.getDate() - diff);
        startDate.setHours(0, 0, 0, 0);
      }

      const rows = await prisma.$queryRaw<Array<{
        userId: string;
        username: string;
        avatarUrl: string | null;
        nameMasked: boolean;
        useTwitterAvatar: boolean;
        provider: string;
        handsPlayed: bigint;
        totalAllInEVProfit: bigint;
        winCount: bigint;
      }>>(Prisma.sql`
        SELECT
          hp."userId",
          u."username",
          u."avatarUrl",
          u."nameMasked",
          u."useTwitterAvatar",
          u."provider",
          COUNT(*)                                              AS "handsPlayed",
          SUM(COALESCE(hp."allInEVProfit", hp."profit"))        AS "totalAllInEVProfit",
          SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)     AS "winCount"
        FROM "HandHistoryPlayer" hp
        JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
        JOIN "User" u ON hp."userId" = u."id"
        WHERE hp."userId" IS NOT NULL
          AND hh."createdAt" >= ${startDate}
        GROUP BY hp."userId", u."username", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider"
        HAVING COUNT(*) >= ${MIN_HANDS}
      `);

      result = {
        rankings: rows.map(r => ({
          userId: r.userId,
          username: r.nameMasked ? maskName(r.username) : r.username,
          avatarUrl: r.useTwitterAvatar ? (r.avatarUrl ?? null) : null,
          isBot: r.provider === 'bot',
          handsPlayed: Number(r.handsPlayed),
          totalAllInEVProfit: Number(r.totalAllInEVProfit),
          winCount: Number(r.winCount),
        })),
      };
    }

    rankingsCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  });
}
