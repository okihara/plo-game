import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { awardRankingBadge } from './badgeService.js';
import { maskName } from '../../shared/utils.js';

const JST_RESET_HOUR_UTC = 15; // UTC 15:00 = JST 0:00
const MIN_HANDS = 10;

/** ランキング全体を取得（スナップショット保存用） */
async function fetchWeeklyRankings(startDate: Date, endDate: Date) {
  return prisma.$queryRaw<Array<{
    userId: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    nameMasked: boolean;
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
      AND hh."createdAt" < ${endDate}
    GROUP BY hp."userId", u."username", u."displayName", u."avatarUrl", u."nameMasked", u."provider"
    HAVING COUNT(*) >= ${MIN_HANDS}
    ORDER BY "totalAllInEVProfit" DESC
  `);
}

/** ランキング行を API 互換の JSON 形式に変換 */
function toRankingEntries(rows: Awaited<ReturnType<typeof fetchWeeklyRankings>>) {
  return rows.map(r => ({
    userId: r.userId,
    username: r.displayName ? r.displayName : (r.nameMasked ? maskName(r.username) : r.username),
    avatarUrl: r.avatarUrl ?? null,
    isBot: r.provider === 'bot',
    handsPlayed: Number(r.handsPlayed),
    totalAllInEVProfit: Number(r.totalAllInEVProfit),
    winCount: Number(r.winCount),
  }));
}

/** 前期間のランキング1位にバッジを付与（weeklyの場合はスナップショットも保存） */
async function awardPeriodRankingBadges(period: 'daily' | 'weekly'): Promise<void> {
  const now = new Date();

  // リセット直後に呼ばれるので、「前」期間の範囲を求める
  const todayReset = new Date(now);
  todayReset.setUTCHours(JST_RESET_HOUR_UTC, 0, 0, 0);
  if (now < todayReset) {
    todayReset.setUTCDate(todayReset.getUTCDate() - 1);
  }

  let startDate: Date;
  const endDate = new Date(todayReset);

  if (period === 'daily') {
    startDate = new Date(todayReset);
    startDate.setUTCDate(startDate.getUTCDate() - 1);
  } else {
    // 前週: 7日前から今週月曜リセットまで
    startDate = new Date(todayReset);
    startDate.setUTCDate(startDate.getUTCDate() - 7);
  }

  if (period === 'weekly') {
    // 全ランキングを取得してスナップショット保存 + 1位にバッジ付与
    const rows = await fetchWeeklyRankings(startDate, endDate);
    const rankings = toRankingEntries(rows);

    // スナップショット保存
    await prisma.weeklyRankingSnapshot.upsert({
      where: { weekStart: startDate },
      create: { weekStart: startDate, rankings },
      update: { rankings },
    });
    console.log(`[BadgeScheduler] Saved weekly snapshot for ${startDate.toISOString()} (${rankings.length} players)`);

    // 1位（Bot除外）にバッジ付与
    const topHuman = rows.find(r => r.provider !== 'bot');
    if (topHuman) {
      await awardRankingBadge(topHuman.userId, 'weekly_rank_1');
      console.log(`[BadgeScheduler] Awarded weekly_rank_1 to ${topHuman.userId}`);
    } else {
      console.log('[BadgeScheduler] No qualifying players for weekly ranking badge');
    }
  } else {
    // daily: 1位のみ取得（従来通り）
    const rows = await prisma.$queryRaw<Array<{ userId: string; totalAllInEVProfit: bigint }>>(Prisma.sql`
      SELECT
        hp."userId",
        SUM(COALESCE(hp."allInEVProfit", hp."profit")) AS "totalAllInEVProfit"
      FROM "HandHistoryPlayer" hp
      JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
      JOIN "User" u ON hp."userId" = u."id"
      WHERE hp."userId" IS NOT NULL
        AND u."provider" != 'bot'
        AND hh."tournamentId" IS NULL
        AND hh."createdAt" >= ${startDate}
        AND hh."createdAt" < ${endDate}
      GROUP BY hp."userId"
      HAVING COUNT(*) >= ${MIN_HANDS}
      ORDER BY "totalAllInEVProfit" DESC
      LIMIT 1
    `);

    if (rows.length > 0) {
      await awardRankingBadge(rows[0].userId, 'daily_rank_1');
      console.log(`[BadgeScheduler] Awarded daily_rank_1 to ${rows[0].userId}`);
    } else {
      console.log('[BadgeScheduler] No qualifying players for daily ranking badge');
    }
  }
}

/** スケジューラを開始 */
export function startRankingBadgeScheduler(): void {
  let lastDailyCheck = '';
  let lastWeeklyCheck = '';

  const CHECK_INTERVAL_MS = 60_000; // 1分ごと

  const check = async () => {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMinute = now.getUTCMinutes();

    // UTC 15:00台（最初の5分間）のみ処理 = JST 0:00
    if (utcHour !== JST_RESET_HOUR_UTC || utcMinute > 5) return;

    const dateKey = now.toISOString().slice(0, 10);

    // デイリーバッジ: 毎日
    if (lastDailyCheck !== dateKey) {
      lastDailyCheck = dateKey;
      try {
        await awardPeriodRankingBadges('daily');
      } catch (err) {
        console.error('[BadgeScheduler] Daily badge error:', err);
      }
    }

    // ウィークリーバッジ: JST月曜のみ
    const jstDay = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const isMonday = jstDay.getUTCDay() === 1;
    const weekKey = `${dateKey}-weekly`;
    if (isMonday && lastWeeklyCheck !== weekKey) {
      lastWeeklyCheck = weekKey;
      try {
        await awardPeriodRankingBadges('weekly');
      } catch (err) {
        console.error('[BadgeScheduler] Weekly badge error:', err);
      }
    }
  };

  setInterval(check, CHECK_INTERVAL_MS);
  console.log('[BadgeScheduler] Started (checking every 60s at UTC 15:00 / JST 0:00)');
}
