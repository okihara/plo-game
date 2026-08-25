/// <reference types="node" />
/**
 * COMPLETED トナメの優勝者を新しい順に一覧する（優勝回数の裏取り用）。
 *
 *   cd server && npx tsx scripts/list-tournament-winners.ts --prod [--limit 40]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const lIdx = process.argv.indexOf('--limit');
const limit = lIdx >= 0 ? Number(process.argv[lIdx + 1]) : 40;

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const tournaments = await prisma.tournament.findMany({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
    take: limit,
    select: { id: true, name: true, completedAt: true },
  });

  for (const t of tournaments) {
    const first = await prisma.tournamentResult.findFirst({
      where: { tournamentId: t.id, position: 1 },
      include: { user: { select: { id: true, username: true, displayName: true } } },
    });
    const d = t.completedAt ? t.completedAt.toISOString().slice(0, 10) : '----------';
    const who = first
      ? `${first.user?.displayName ?? '(null)'} (@${first.user?.username ?? '-'}) ${first.userId}`
      : '(優勝レコードなし)';
    console.log(`${d}  ${t.name.padEnd(28)}  ${who}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
