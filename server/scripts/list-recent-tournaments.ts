/// <reference types="node" />
/**
 * 直近のトーナメント設定を JSON で一覧する（週次コンフィグ表の突き合わせ用）。
 *
 *   cd server && npx tsx scripts/list-recent-tournaments.ts --prod [--limit=7]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, Prisma } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 7;

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
  const tournaments = await prisma.tournament.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const rows = tournaments.map((t) => {
    const schedule = t.blindSchedule as Prisma.JsonArray;
    const first = schedule?.[0] as Record<string, unknown> | undefined;
    return {
      id: t.id,
      name: t.name,
      status: t.status,
      gameVariant: t.gameVariant,
      buyIn: t.buyIn,
      startingChips: t.startingChips,
      minPlayers: t.minPlayers,
      maxPlayers: t.maxPlayers,
      registrationLevels: t.registrationLevels,
      allowReentry: t.allowReentry,
      maxReentries: t.maxReentries,
      reentryDeadlineLevel: t.reentryDeadlineLevel,
      scheduledStartTime: t.scheduledStartTime?.toISOString() ?? null,
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      levelCount: Array.isArray(schedule) ? schedule.length : null,
      firstLevel: first ?? null,
    };
  });
  console.log(JSON.stringify(rows, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
