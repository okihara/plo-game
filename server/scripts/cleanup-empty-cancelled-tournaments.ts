/// <reference types="node" />
/**
 * CANCELLED かつ参加者（TournamentRegistration）が 0 件のトーナメントを削除する。
 *
 * 既定はドライラン（候補表示のみ）。実削除するには --execute を付ける。
 *
 *   cd server && npx tsx scripts/cleanup-empty-cancelled-tournaments.ts --prod
 *   cd server && npx tsx scripts/cleanup-empty-cancelled-tournaments.ts --prod --execute
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const isExecute = process.argv.includes('--execute');

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const candidates = await prisma.tournament.findMany({
    where: {
      status: 'CANCELLED',
      registrations: { none: {} },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      createdAt: true,
      scheduledStartTime: true,
      _count: { select: { registrations: true, results: true, userEvaluations: true } },
    },
  });

  console.log(`${isExecute ? '[EXECUTE]' : '[DRY RUN]'} 対象 ${candidates.length} 件`);
  for (const t of candidates) {
    const scheduled = t.scheduledStartTime ? t.scheduledStartTime.toISOString() : '-';
    console.log(
      `  ${t.id} | ${t.name} | created=${t.createdAt.toISOString()} | scheduled=${scheduled} | regs=${t._count.registrations} results=${t._count.results} evals=${t._count.userEvaluations}`
    );
  }

  if (!isExecute) {
    console.log('\nドライランのため削除はしていません。--execute を付けて再実行してください。');
    return;
  }

  if (candidates.length === 0) return;

  const ids = candidates.map((t) => t.id);
  const res = await prisma.tournament.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n削除完了: ${res.count} 件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
