/// <reference types="node" />
/**
 * Botのハンド数分布を表示するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-hands-stats.ts --prod
 */
import { PrismaClient } from '@prisma/client';

const isProd = process.argv.includes('--prod');

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
  const bots = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: {
      id: true,
      username: true,
      displayName: true,
      statsCache: { select: { handsPlayed: true, totalAllInEVProfit: true } },
    },
    orderBy: { statsCache: { handsPlayed: 'desc' } },
  });

  console.log(`=== Bot ハンド数分布 (${bots.length}体) ===\n`);

  const ranges = [
    { label: '5000+', min: 5000, max: Infinity },
    { label: '3000-4999', min: 3000, max: 4999 },
    { label: '2000-2999', min: 2000, max: 2999 },
    { label: '1000-1999', min: 1000, max: 1999 },
    { label: '500-999', min: 500, max: 999 },
    { label: '100-499', min: 100, max: 499 },
    { label: '1-99', min: 1, max: 99 },
    { label: '0', min: 0, max: 0 },
  ];

  for (const range of ranges) {
    const inRange = bots.filter(b => {
      const h = b.statsCache?.handsPlayed ?? 0;
      return h >= range.min && h <= range.max;
    });
    if (inRange.length > 0) {
      console.log(`--- ${range.label} ハンド: ${inRange.length}体 ---`);
      for (const b of inRange) {
        const h = b.statsCache?.handsPlayed ?? 0;
        const ev = b.statsCache?.totalAllInEVProfit ?? 0;
        console.log(`  ${(b.displayName || b.username).padEnd(20)} ${String(h).padStart(6)} hands  EV: ${ev >= 0 ? '+' : ''}${ev}`);
      }
      console.log('');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
