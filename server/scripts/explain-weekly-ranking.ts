/// <reference types="node" />
/**
 * トップページ週間ランキングクエリの EXPLAIN ANALYZE を確認する診断スクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/explain-weekly-ranking.ts --prod
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined,
);

// routes.ts と同じロジックで今週の月曜 JST 0:00 を求める
function weekStartDate(): Date {
  const JST_RESET_HOUR_UTC = 15;
  const now = new Date();
  const todayReset = new Date(now);
  todayReset.setUTCHours(JST_RESET_HOUR_UTC, 0, 0, 0);
  if (now < todayReset) todayReset.setUTCDate(todayReset.getUTCDate() - 1);
  const jstDay = new Date(todayReset.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = jstDay.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = new Date(todayReset);
  weekStart.setUTCDate(weekStart.getUTCDate() - daysFromMonday);
  return weekStart;
}

async function explain(label: string, sql: string) {
  console.log(`\n===== ${label} =====`);
  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
  );
  for (const r of rows) console.log(r['QUERY PLAN']);
}

async function main() {
  const start = weekStartDate();
  console.log('weekStart =', start.toISOString());

  const counts = await prisma.$queryRawUnsafe<Array<{ hh: bigint; hp: bigint; hpNullCreatedAt: bigint }>>(`
    SELECT
      (SELECT COUNT(*) FROM "HandHistory" WHERE "createdAt" >= '${start.toISOString()}') AS hh,
      (SELECT COUNT(*) FROM "HandHistoryPlayer" WHERE "createdAt" >= '${start.toISOString()}') AS hp,
      (SELECT COUNT(*) FROM "HandHistoryPlayer" hp JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
        WHERE hh."createdAt" >= '${start.toISOString()}' AND hp."createdAt" IS NULL) AS "hpNullCreatedAt"
  `);
  console.log('今週の行数: HandHistory =', counts[0].hh, ', HandHistoryPlayer =', counts[0].hp,
    ', 非正規化createdAtがNULLのhp行 =', counts[0].hpNullCreatedAt);

  if (!process.argv.includes('--skip-join')) await explain('現行クエリ (JOIN + hh.createdAt)', `
    SELECT
      hp."userId",
      u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider",
      COUNT(*)                                          AS "handsPlayed",
      SUM(COALESCE(hp."allInEVProfit", hp."profit"))    AS "totalAllInEVProfit",
      SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)  AS "winCount"
    FROM "HandHistoryPlayer" hp
    JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
    JOIN "User" u ON hp."userId" = u."id"
    WHERE hp."userId" IS NOT NULL
      AND hh."tournamentId" IS NULL
      AND hh."createdAt" >= '${start.toISOString()}'
    GROUP BY hp."userId", u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider"
    HAVING COUNT(*) >= 10
  `);

  await explain('非正規化列で JOIN を外した版 (hp.createdAt / hp.tournamentId)', `
    SELECT
      hp."userId",
      u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider",
      COUNT(*)                                          AS "handsPlayed",
      SUM(COALESCE(hp."allInEVProfit", hp."profit"))    AS "totalAllInEVProfit",
      SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)  AS "winCount"
    FROM "HandHistoryPlayer" hp
    JOIN "User" u ON hp."userId" = u."id"
    WHERE hp."userId" IS NOT NULL
      AND hp."tournamentId" IS NULL
      AND hp."createdAt" >= '${start.toISOString()}'
    GROUP BY hp."userId", u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider"
    HAVING COUNT(*) >= 10
  `);

  await explain('集計を先に行い User を後から JOIN する版', `
    SELECT
      s."userId",
      u."username", u."displayName", u."avatarUrl", u."nameMasked", u."useTwitterAvatar", u."provider",
      s."handsPlayed", s."totalAllInEVProfit", s."winCount"
    FROM (
      SELECT
        hp."userId",
        COUNT(*)                                          AS "handsPlayed",
        SUM(COALESCE(hp."allInEVProfit", hp."profit"))    AS "totalAllInEVProfit",
        SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)  AS "winCount"
      FROM "HandHistoryPlayer" hp
      WHERE hp."userId" IS NOT NULL
        AND hp."tournamentId" IS NULL
        AND hp."createdAt" >= '${start.toISOString()}'
      GROUP BY hp."userId"
      HAVING COUNT(*) >= 10
    ) s
    JOIN "User" u ON s."userId" = u."id"
  `);

  const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string; indexdef: string }>>(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename IN ('HandHistory', 'HandHistoryPlayer') ORDER BY indexname
  `);
  console.log('\n===== 既存インデックス =====');
  for (const i of idx) console.log(i.indexdef);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
