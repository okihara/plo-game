/**
 * 全バッジ一括判定・付与スクリプト
 * - ハンド数バッジ (1000/3000/10000)
 * - デイリーランキング1位バッジ（過去全日分）
 * - ウィークリーランキング1位バッジ（過去全週分）
 *
 * 実行: cd server && DATABASE_URL="..." npx tsx scripts/award-all-badges.ts
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/config/database.js';

const HAND_MILESTONES = [
  { threshold: 1000, type: 'hands_1000' },
  { threshold: 3000, type: 'hands_3000' },
  { threshold: 10000, type: 'hands_10000' },
];

const MIN_HANDS_FOR_RANKING = 10;

async function awardHandCountBadges() {
  console.log('\n=== ハンド数バッジ ===');

  // PlayerStatsCacheからハンド数を取得（インクリメンタル更新済みの正確な値）
  const rows = await prisma.$queryRaw<Array<{ userId: string; count: bigint }>>(Prisma.sql`
    SELECT "userId", "handsPlayed" as count
    FROM "PlayerStatsCache"
    WHERE "userId" IS NOT NULL
  `);

  // 既存バッジを取得
  const existingBadges = await prisma.badge.findMany({
    where: { type: { in: HAND_MILESTONES.map(m => m.type) } },
    select: { userId: true, type: true },
  });
  const existingSet = new Set(existingBadges.map(b => `${b.userId}:${b.type}`));

  const toCreate: { userId: string; type: string }[] = [];

  for (const row of rows) {
    const count = Number(row.count);
    for (const { threshold, type } of HAND_MILESTONES) {
      if (count >= threshold && !existingSet.has(`${row.userId}:${type}`)) {
        toCreate.push({ userId: row.userId, type });
      }
    }
  }

  if (toCreate.length === 0) {
    console.log('新規付与なし');
  } else {
    const result = await prisma.badge.createMany({ data: toCreate });
    // 内訳を表示
    for (const { type } of HAND_MILESTONES) {
      const n = toCreate.filter(b => b.type === type).length;
      if (n > 0) console.log(`  ${type}: ${n}人`);
    }
    console.log(`✅ 合計 ${result.count} 件付与`);
  }
}

async function awardDailyRankingBadges() {
  console.log('\n=== デイリーランキング1位バッジ ===');

  // 日ごとに1位を集計（JST 3:00 = UTC 18:00 区切り）
  const rows = await prisma.$queryRaw<Array<{ userId: string; day: string; totalProfit: bigint }>>(Prisma.sql`
    WITH daily AS (
      SELECT
        hp."userId",
        DATE(hh."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo' - INTERVAL '3 hours') as day,
        SUM(COALESCE(hp."allInEVProfit", hp."profit")) AS "totalProfit",
        COUNT(*) as hands
      FROM "HandHistoryPlayer" hp
      JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
      JOIN "User" u ON hp."userId" = u."id"
      WHERE hp."userId" IS NOT NULL AND u."provider" != 'bot'
      GROUP BY hp."userId", day
      HAVING COUNT(*) >= ${MIN_HANDS_FOR_RANKING}
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY day ORDER BY "totalProfit" DESC) as rn
      FROM daily
    )
    SELECT "userId", day::text, "totalProfit"
    FROM ranked
    WHERE rn = 1 AND "totalProfit" > 0
    ORDER BY day
  `);

  // 既存のデイリーバッジを取得（日付ごとの重複チェック用）
  const existingDaily = await prisma.badge.findMany({
    where: { type: 'daily_rank_1' },
    select: { userId: true, awardedAt: true },
  });

  // awardedAtの日付をキーにして既存を判定
  const existingDaySet = new Set(
    existingDaily.map(b => {
      const jst = new Date(b.awardedAt.getTime() + 9 * 60 * 60 * 1000);
      return `${jst.toISOString().slice(0, 10)}`;
    })
  );

  const toCreate: { userId: string; type: string }[] = [];
  for (const row of rows) {
    if (!existingDaySet.has(row.day)) {
      toCreate.push({ userId: row.userId, type: 'daily_rank_1' });
      console.log(`  ${row.day}: ${row.userId} (profit: ${row.totalProfit})`);
    }
  }

  if (toCreate.length === 0) {
    console.log('新規付与なし');
  } else {
    const result = await prisma.badge.createMany({ data: toCreate });
    console.log(`✅ ${result.count} 日分付与`);
  }
}

async function awardWeeklyRankingBadges() {
  console.log('\n=== ウィークリーランキング1位バッジ ===');

  // 週ごとに1位を集計（月曜JST 3:00区切り）
  const rows = await prisma.$queryRaw<Array<{ userId: string; week: string; totalProfit: bigint }>>(Prisma.sql`
    WITH weekly AS (
      SELECT
        hp."userId",
        DATE_TRUNC('week', (hh."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Tokyo' - INTERVAL '3 hours')::date)::date::text as week,
        SUM(COALESCE(hp."allInEVProfit", hp."profit")) AS "totalProfit",
        COUNT(*) as hands
      FROM "HandHistoryPlayer" hp
      JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
      JOIN "User" u ON hp."userId" = u."id"
      WHERE hp."userId" IS NOT NULL AND u."provider" != 'bot'
      GROUP BY hp."userId", week
      HAVING COUNT(*) >= ${MIN_HANDS_FOR_RANKING}
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY week ORDER BY "totalProfit" DESC) as rn
      FROM weekly
    )
    SELECT "userId", week, "totalProfit"
    FROM ranked
    WHERE rn = 1 AND "totalProfit" > 0
    ORDER BY week
  `);

  const existingWeekly = await prisma.badge.findMany({
    where: { type: 'weekly_rank_1' },
    select: { userId: true, awardedAt: true },
  });

  const existingWeekSet = new Set(
    existingWeekly.map(b => {
      const jst = new Date(b.awardedAt.getTime() + 9 * 60 * 60 * 1000);
      // 週の月曜日を求める
      const day = jst.getUTCDay();
      const diff = day === 0 ? 6 : day - 1;
      const monday = new Date(jst);
      monday.setUTCDate(monday.getUTCDate() - diff);
      return monday.toISOString().slice(0, 10);
    })
  );

  const toCreate: { userId: string; type: string }[] = [];
  for (const row of rows) {
    if (!existingWeekSet.has(row.week)) {
      toCreate.push({ userId: row.userId, type: 'weekly_rank_1' });
      console.log(`  week ${row.week}: ${row.userId} (profit: ${row.totalProfit})`);
    }
  }

  if (toCreate.length === 0) {
    console.log('新規付与なし');
  } else {
    const result = await prisma.badge.createMany({ data: toCreate });
    console.log(`✅ ${result.count} 週分付与`);
  }
}

async function main() {
  await awardHandCountBadges();
  await awardDailyRankingBadges();
  await awardWeeklyRankingBadges();
  console.log('\n完了');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
