/// <reference types="node" />
/**
 * 指定ユーザーのトーナメント優勝回数を数える。
 *
 *   cd server && npx tsx scripts/count-tournament-wins.ts --prod --user <userId>
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const uIdx = process.argv.indexOf('--user');
const userId = uIdx >= 0 ? process.argv[uIdx + 1] : undefined;

if (!userId) {
  console.error('ERROR: --user <userId> を指定してください');
  process.exit(1);
}

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, displayName: true },
  });
  if (!user) {
    console.error('ユーザーが見つかりません');
    process.exit(1);
  }

  const wins = await prisma.tournamentResult.findMany({
    where: { userId, position: 1 },
    include: {
      tournament: { select: { id: true, name: true, completedAt: true, status: true } },
    },
    orderBy: { tournament: { completedAt: 'asc' } },
  });

  console.log(JSON.stringify({
    user,
    winCount: wins.length,
    wins: wins.map((w) => ({
      tournamentId: w.tournament.id,
      name: w.tournament.name,
      completedAt: w.tournament.completedAt,
      status: w.tournament.status,
    })),
  }, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
