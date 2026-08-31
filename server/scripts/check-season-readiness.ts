/// <reference types="node" />
/**
 * シーズン切替前の状態チェック（読み取りのみ）。
 *
 * 切替（RESULT_SEASON を進める／CURRENT_SEASON を次シーズンにする）の前に、
 * スナップショット生成とバッジ付与が済んでいるかを確認する。
 *
 *   cd server && npx tsx scripts/check-season-readiness.ts --prod
 *   cd server && npx tsx scripts/check-season-readiness.ts          # ローカルDB
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { SEASONS, CURRENT_SEASON, RESULT_SEASON, seasonBadgePrefix } from '../src/modules/season/seasonConfig.js';
import { seasonBadgeTypes } from '../src/modules/badges/badgeService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に未設定です');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  console.log(`接続先: ${isProd ? '本番DB' : 'ローカルDB'}`);
  console.log(`CURRENT_SEASON=${CURRENT_SEASON.name} / RESULT_SEASON=${RESULT_SEASON.name}\n`);

  const snapshots = await prisma.seasonSnapshot.findMany({ select: { seasonName: true, generatedAt: true } });
  const snapshotByName = new Map(snapshots.map(s => [s.seasonName, s.generatedAt]));

  for (const season of SEASONS) {
    const prefix = seasonBadgePrefix(season);
    const grouped = await prisma.badge.groupBy({
      by: ['type'],
      where: { type: { in: seasonBadgeTypes(prefix) } },
      _count: { _all: true },
    });
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const snapshotAt = snapshotByName.get(season.name);

    console.log(`■ ${season.name} (${season.label})`);
    console.log(`  スナップショット: ${snapshotAt ? `あり (生成 ${snapshotAt.toISOString()})` : 'なし'}`);
    console.log(`  バッジ: ${total === 0 ? 'なし' : `${total}枚`}`);
    for (const g of grouped.sort((a, b) => a.type.localeCompare(b.type))) {
      console.log(`    ${g.type}: ${g._count._all}`);
    }
    console.log('');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
