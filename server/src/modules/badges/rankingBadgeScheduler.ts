import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { awardRankingBadge } from './badgeService.js';

const JST_RESET_HOUR_UTC = 22; // UTC 22:00 = JST 7:00
const MIN_HANDS = 10;

/** 前期間のランキング1位にバッジを付与 */
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

  const rows = await prisma.$queryRaw<Array<{ userId: string; totalAllInEVProfit: bigint }>>(Prisma.sql`
    SELECT
      hp."userId",
      SUM(COALESCE(hp."allInEVProfit", hp."profit")) AS "totalAllInEVProfit"
    FROM "HandHistoryPlayer" hp
    JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
    JOIN "User" u ON hp."userId" = u."id"
    WHERE hp."userId" IS NOT NULL
      AND u."provider" != 'bot'
      AND hh."createdAt" >= ${startDate}
      AND hh."createdAt" < ${endDate}
    GROUP BY hp."userId"
    HAVING COUNT(*) >= ${MIN_HANDS}
    ORDER BY "totalAllInEVProfit" DESC
    LIMIT 1
  `);

  if (rows.length > 0) {
    const badgeType = period === 'daily' ? 'daily_rank_1' as const : 'weekly_rank_1' as const;
    await awardRankingBadge(rows[0].userId, badgeType);
    console.log(`[BadgeScheduler] Awarded ${badgeType} to ${rows[0].userId}`);
  } else {
    console.log(`[BadgeScheduler] No qualifying players for ${period} ranking badge`);
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

    // UTC 22:00台（最初の5分間）のみ処理
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
  console.log('[BadgeScheduler] Started (checking every 60s at UTC 22:00 / JST 7:00)');
}
