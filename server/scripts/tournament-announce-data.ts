/// <reference types="node" />
/**
 * 告知ツイート用に「直近で終わったトナメ」の最小サマリを JSON で出力する。
 *
 *   cd server && npx tsx scripts/tournament-announce-data.ts --prod
 *
 * 出力には優勝者名・エントリー数・経過時間しか含めない。
 * 直近の COMPLETED が48時間より古ければ stale=true で返す（呼び出し側で省略する想定）。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { maskName } from '../src/shared/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');

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

function resolveDisplay(u: { displayName: string | null; username: string; nameMasked: boolean }) {
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

async function main() {
  const tournament = await prisma.tournament.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
  });

  if (!tournament || !tournament.completedAt) {
    console.log(JSON.stringify({ tournament: null }, null, 2));
    return;
  }

  const [registrations, winnerResult] = await Promise.all([
    prisma.tournamentRegistration.findMany({
      where: { tournamentId: tournament.id },
      select: { reentryCount: true },
    }),
    prisma.tournamentResult.findFirst({
      where: { tournamentId: tournament.id, position: 1 },
      include: {
        user: { select: { username: true, displayName: true, nameMasked: true } },
      },
    }),
  ]);

  const totalEntries =
    registrations.length + registrations.reduce((s, r) => s + r.reentryCount, 0);
  const hoursAgo = (Date.now() - tournament.completedAt.getTime()) / 3_600_000;

  console.log(
    JSON.stringify(
      {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          completedAt: tournament.completedAt.toISOString(),
          hoursAgo: Math.round(hoursAgo * 10) / 10,
          stale: hoursAgo > 48,
          totalEntries,
          uniqueRegistrations: registrations.length,
        },
        winner: winnerResult
          ? { displayName: resolveDisplay(winnerResult.user) }
          : null,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
