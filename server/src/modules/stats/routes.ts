import { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import type { PlayerStats } from './computeStats.js';
import { maskName } from '../../shared/utils.js';
import { getUserBadges, groupBadgesForDisplay } from '../badges/badgeService.js';
import { buildProfitHistoryPoints } from './profitHistory.js';

// ランキングキャッシュ（60秒TTL）
const rankingsCache = new Map<string, { data: unknown; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

// 収支グラフの最大ポイント数（超過分は等間隔バケットにダウンサンプリング）
const PROFIT_HISTORY_MAX_POINTS = 2000;

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };

    const [cache, tournamentCache, tournamentResults, rawBadges, user] = await Promise.all([
      prisma.playerStatsCache.findUnique({ where: { userId } }),
      prisma.tournamentStatsCache.findUnique({ where: { userId } }),
      prisma.tournamentResult.findMany({
        where: { userId },
        select: {
          prize: true,
          reentries: true,
          tournament: { select: { buyIn: true } },
        },
      }),
      getUserBadges(userId),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true, nameMasked: true } }),
    ]);

    const tournamentsPlayed = tournamentResults.length;
    const tournamentBankrollProfit = tournamentResults.reduce(
      (sum, r) => sum + r.prize - r.tournament.buyIn * (1 + r.reentries),
      0,
    );

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
    const tournamentStats: (PlayerStats & { tournamentsPlayed: number }) | null =
      tournamentCache && tournamentCache.handsPlayed > 0
        ? {
            ...toStats(tournamentCache),
            // トーナメントの実収支はバンクロール視点の賞金収支で上書き
            totalProfit: tournamentBankrollProfit,
            totalAllInEVProfit: tournamentBankrollProfit,
            tournamentsPlayed,
          }
        : null;

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
      // カバリングインデックス (userId, tournamentId, createdAt, profit, finalHand, allInEVProfit)
      // の index-only scan に乗せるため raw SQL を使う。Prisma の findMany は select 指定でも
      // 暗黙に id を SELECT に含めるため index-only にならず、数万ハンド級ユーザーで
      // ヒープランダム読みが50秒超かかる。
      prisma.$queryRaw<Array<{ profit: number; finalHand: string | null; allInEVProfit: number | null }>>(
        Prisma.sql`
          SELECT "profit", "finalHand", "allInEVProfit"
          FROM "HandHistoryPlayer"
          WHERE "userId" = ${userId} AND "tournamentId" IS NULL
          ORDER BY "createdAt" ASC
        `,
      ),
      prisma.playerStatsCache.findUnique({
        where: { userId },
        select: { totalProfit: true, totalAllInEVProfit: true },
      }),
    ]);

    // スタッツキャッシュからEV補正値を計算
    // DB の allInEVProfit はほとんど NULL のため、キャッシュの差分を使って補正する
    const cacheEvDiff = cache ? cache.totalAllInEVProfit - cache.totalProfit : 0;

    const { points, totalHands } = buildProfitHistoryPoints(rows, cacheEvDiff, PROFIT_HISTORY_MAX_POINTS);
    return { points, totalHands };
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

      // HandHistory と JOIN すると 1,900万行超の HandHistoryPlayer がフルスキャンされ約60秒かかるため、
      // 非正規化コピー（hp.tournamentId / hp.createdAt）で JOIN を外す。
      // 対象期間は直近の日/週のみで、非正規化列はバックフィル済み（NULL は期間外の旧データのみ）。
      // さらに集計をサブクエリに分けて User との JOIN を集計後（〜200行）に行うことで、
      // ranking 用カバリングインデックスの index-only scan に乗せる（実測 59s → 0.3s）。
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
          s."userId",
          u."username",
          u."displayName",
          u."avatarUrl",
          u."nameMasked",
          u."useTwitterAvatar",
          u."provider",
          s."handsPlayed",
          s."totalAllInEVProfit",
          s."winCount"
        FROM (
          SELECT
            hp."userId",
            COUNT(*)                                              AS "handsPlayed",
            SUM(COALESCE(hp."allInEVProfit", hp."profit"))        AS "totalAllInEVProfit",
            SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)     AS "winCount"
          FROM "HandHistoryPlayer" hp
          WHERE hp."userId" IS NOT NULL
            AND hp."tournamentId" IS NULL
            AND hp."createdAt" >= ${startDate}
            ${endDate ? Prisma.sql`AND hp."createdAt" < ${endDate}` : Prisma.empty}
          GROUP BY hp."userId"
          HAVING COUNT(*) >= ${MIN_HANDS}
        ) s
        JOIN "User" u ON s."userId" = u."id"
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
