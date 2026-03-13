/// <reference types="node" />
/**
 * 人間プレイヤーの接続推移（ハンド履歴ベース）を表示するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/human-activity-stats.ts --prod
 *   cd server && npx tsx scripts/human-activity-stats.ts --prod --hours 48
 *   cd server && npx tsx scripts/human-activity-stats.ts --prod --daily
 */
import { PrismaClient, Prisma } from '@prisma/client';

const isProd = process.argv.includes('--prod');
const isDaily = process.argv.includes('--daily');

const hoursIdx = process.argv.indexOf('--hours');
const hours = hoursIdx !== -1 ? parseInt(process.argv[hoursIdx + 1], 10) : (isDaily ? 168 : 48);

if (isProd) {
  const url = process.env.DATABASE_PROD_PUBLIC_URL;
  if (!url) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します\n');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

async function main() {
  const truncUnit = isDaily ? 'day' : 'hour';

  const rows = await prisma.$queryRaw<
    { period: Date; unique_humans: bigint; hands_with_humans: bigint }[]
  >(Prisma.sql`
    SELECT
      date_trunc(${truncUnit}, h."createdAt" AT TIME ZONE 'Asia/Tokyo') AS period,
      COUNT(DISTINCT hp."userId") AS unique_humans,
      COUNT(DISTINCT h.id) AS hands_with_humans
    FROM "HandHistory" h
    JOIN "HandHistoryPlayer" hp ON hp."handHistoryId" = h.id
    JOIN "User" u ON u.id = hp."userId"
    WHERE h."createdAt" >= NOW() - make_interval(hours => ${hours}::int)
      AND u.provider = 'twitter'
    GROUP BY 1
    ORDER BY 1
  `);

  if (rows.length === 0) {
    console.log('データなし');
    return;
  }

  console.log(`期間: 過去${hours}時間 (${isDaily ? '日別' : '時間別'})\n`);

  if (isDaily) {
    console.log('日付        | ユニーク人数 | ハンド数 | 一人あたり');
    console.log('------------|------------|---------|----------');
    for (const row of rows) {
      const date = new Date(row.period).toLocaleDateString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      });
      const humans = Number(row.unique_humans);
      const hands = Number(row.hands_with_humans);
      const perHuman = humans > 0 ? (hands / humans).toFixed(1) : '-';
      console.log(
        `${date.padEnd(12)}| ${String(humans).padStart(10)} | ${String(hands).padStart(7)} | ${String(perHuman).padStart(8)}`
      );
    }
  } else {
    console.log('時刻 (JST)      | 人数 | ハンド数');
    console.log('----------------|------|--------');
    for (const row of rows) {
      const dt = new Date(row.period).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const humans = Number(row.unique_humans);
      const hands = Number(row.hands_with_humans);
      const bar = '█'.repeat(Math.min(humans, 30));
      console.log(
        `${dt.padEnd(16)}| ${String(humans).padStart(4)} | ${String(hands).padStart(6)}  ${bar}`
      );
    }
  }

  console.log(`\n合計: ${rows.length}行`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
