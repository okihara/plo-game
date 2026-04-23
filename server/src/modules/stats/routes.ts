import { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import type { PlayerStats } from './computeStats.js';
import { maskName } from '../../shared/utils.js';
import { getUserBadges, groupBadgesForDisplay } from '../badges/badgeService.js';

// ランキングキャッシュ（60秒TTL）
const rankingsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };

    const [cache, tournamentCache, rawBadges, user] = await Promise.all([
      prisma.playerStatsCache.findUnique({ where: { userId } }),
      prisma.tournamentStatsCache.findUnique({ where: { userId } }),
      getUserBadges(userId),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true, nameMasked: true } }),
    ]);

    const badges = groupBadgesForDisplay(rawBadges);
    const displayName = user
      ? (user.displayName || (user.nameMasked ? maskName(user.username) : user.username))
      : null;

    const pct = (num: number, denom: number) => denom > 0 ? (num / denom) * 100 : 0;

    type CacheRow = NonNullable<typeof cache>;
    const toStats = (c: CacheRow): PlayerStats => ({
      handsPlayed: c.handsPlayed,
      winRate: c.handsPlayed > 0 ? c.totalProfit / c.handsPlayed : 0,
      totalProfit: c.totalProfit,
      totalAllInEVProfit: c.totalAllInEVProfit,
      vpip: pct(c.vpipCount, c.detailedHands),
      pfr: pct(c.pfrCount, c.detailedHands),
      threeBet: pct(c.threeBetCount, c.threeBetOpportunity),
      fourBet: pct(c.fourBetCount, c.fourBetOpportunity),
      afq: pct(c.aggressiveActions, c.totalPostflopActions),
      cbet: pct(c.cbetCount, c.cbetOpportunity),
      foldToCbet: pct(c.foldToCbetCount, c.facedCbetCount),
      foldTo3Bet: pct(c.foldTo3BetCount, c.faced3BetCount),
      wtsd: pct(c.wtsdCount, c.sawFlopCount),
      wsd: pct(c.wsdCount, c.wtsdCount),
    });

    const stats = cache && cache.handsPlayed > 0 ? toStats(cache) : null;
    const tournamentStats = tournamentCache && tournamentCache.handsPlayed > 0 ? toStats(tournamentCache) : null;

    return {
      stats,
      tournamentStats,
      handsAnalyzed: cache?.handsPlayed ?? 0,
      tournamentHandsAnalyzed: tournamentCache?.handsPlayed ?? 0,
      badges,
      displayName,
    };
  });

  // 収支推移データ（グラフ用）
  fastify.get('/:userId/profit-history', async (request: FastifyRequest) => {
    const { userId } = request.params as { userId: string };

    const [rows, cache] = await Promise.all([
      prisma.handHistoryPlayer.findMany({
        where: { userId, handHistory: { tournamentId: null } },
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
    const { period = 'all', weekOffset: weekOffsetStr } = request.query as { period?: string; weekOffset?: string };
    const weekOffset = weekOffsetStr ? Math.max(0, Math.min(12, parseInt(weekOffsetStr, 10) || 0)) : 0;
    const MIN_HANDS = 10;

    // キャッシュチェック（60秒TTL）
    const cacheKey = `rankings:${period}:${weekOffset}`;
    const cached = rankingsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    let result: { rankings: unknown[] };

    // weekly + weekOffset>0: スナップショットがあればそれを返す
    if (period === 'weekly' && weekOffset > 0) {
      const JST_RESET_HOUR_UTC = 15; // UTC 15:00 = JST 0:00
      const now = new Date();
      const todayReset = new Date(now);
      todayReset.setUTCHours(JST_RESET_HOUR_UTC, 0, 0, 0);
      if (now < todayReset) {
        todayReset.setUTCDate(todayReset.getUTCDate() - 1);
      }
      const jstDay = new Date(todayReset.getTime() + 9 * 60 * 60 * 1000);
      const dayOfWeek = jstDay.getUTCDay();
      const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(todayReset);
      weekStart.setUTCDate(weekStart.getUTCDate() - daysFromMonday - 7 * weekOffset);

      const snapshot = await prisma.weeklyRankingSnapshot.findUnique({
        where: { weekStart },
      });
      result = { rankings: snapshot ? snapshot.rankings as unknown[] : [] };
      rankingsCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

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
              displayName: true,
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
          username: cache.user.displayName ? cache.user.displayName : (cache.user.nameMasked ? maskName(cache.user.username) : cache.user.username),
          avatarUrl: cache.user.avatarUrl ?? null,
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
      // JST 0:00 = UTC 15:00 をリセット基準にする
      const JST_RESET_HOUR_UTC_LIVE = 15; // JST 0:00

      // 今日のリセット時刻（UTC 15:00）を求め、まだ到達していなければ前日に戻す
      const todayReset = new Date(now);
      todayReset.setUTCHours(JST_RESET_HOUR_UTC_LIVE, 0, 0, 0);
      if (now < todayReset) {
        todayReset.setUTCDate(todayReset.getUTCDate() - 1);
      }

      let endDate: Date | null = null;

      if (period === 'daily') {
        startDate.setTime(todayReset.getTime());
      } else {
        // 今週の月曜 JST 0:00（月曜始まり）
        const jstDay = new Date(todayReset.getTime() + 9 * 60 * 60 * 1000);
        const dayOfWeek = jstDay.getUTCDay(); // 0=日, 1=月, ..., 6=土
        const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        startDate.setTime(todayReset.getTime());
        startDate.setUTCDate(startDate.getUTCDate() - daysFromMonday);

        // weekOffset: 過去の週へオフセット
        if (weekOffset > 0) {
          startDate.setUTCDate(startDate.getUTCDate() - 7 * weekOffset);
          endDate = new Date(startDate);
          endDate.setUTCDate(endDate.getUTCDate() + 7);
        }
      }

      const rows = await prisma.$queryRaw<Array<{
        userId: string;
        username: string;
        displayName: string | null;
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
          u."displayName",
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
          AND hh."tournamentId" IS NULL
          AND hh."createdAt" >= ${startDate}
          ${endDate ? Prisma.sql`AND hh."createdAt" < ${endDate}` : Prisma.empty}
        GROUP BY hp."userId", u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider"
        HAVING COUNT(*) >= ${MIN_HANDS}
      `);

      result = {
        rankings: rows.map(r => ({
          userId: r.userId,
          username: r.displayName ? r.displayName : (r.nameMasked ? maskName(r.username) : r.username),
          avatarUrl: r.avatarUrl ?? null,
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

  // 直近の週間ランキング1位（チャンピオン）一覧
  fastify.get('/weekly-champions', async (request: FastifyRequest) => {
    const { limit: limitStr } = request.query as { limit?: string };
    const limit = Math.max(1, Math.min(50, parseInt(limitStr || '3', 10) || 3));
    const cacheKey = `weekly-champions:${limit}`;
    const cached = rankingsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }

    const badges = await prisma.badge.findMany({
      where: { type: 'weekly_rank_1' },
      orderBy: { awardedAt: 'desc' },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarUrl: true,
            nameMasked: true,
          },
        },
      },
    });

    const result = {
      champions: badges.map(b => ({
        userId: b.user.id,
        username: b.user.displayName
          ? b.user.displayName
          : (b.user.nameMasked ? maskName(b.user.username) : b.user.username),
        avatarUrl: b.user.avatarUrl ?? null,
        awardedAt: b.awardedAt.toISOString(),
      })),
    };

    rankingsCache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  });
}
