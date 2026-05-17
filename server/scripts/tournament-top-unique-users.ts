/// <reference types="node" />
/**
 * ユニーク参加ユーザー数が多いトナメ TOP N を集計
 *
 * 実行:
 *   cd server && npx tsx scripts/tournament-top-unique-users.ts --prod
 *   cd server && npx tsx scripts/tournament-top-unique-users.ts --prod --limit=20
 *   cd server && npx tsx scripts/tournament-top-unique-users.ts --prod --status=COMPLETED
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 10) : 10;

const statusArg = process.argv.find((a) => a.startsWith('--status='));
const statusFilter = statusArg ? statusArg.split('=')[1] : null;

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
  const grouped = await prisma.tournamentRegistration.groupBy({
    by: ['tournamentId'],
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
    take: limit * 3, // ステータスで絞った後でも limit 件残るよう余裕を持たせる
  });

  if (grouped.length === 0) {
    console.log('トナメの参加登録が見つかりませんでした');
    return;
  }

  const ids = grouped.map((g) => g.tournamentId);
  const tournaments = await prisma.tournament.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      status: true,
      buyIn: true,
      scheduledStartTime: true,
      startedAt: true,
      completedAt: true,
    },
  });
  const byId = new Map(tournaments.map((t) => [t.id, t]));

  let rows = grouped
    .map((g) => ({ t: byId.get(g.tournamentId), uniqueUsers: g._count.userId }))
    .filter((r) => r.t !== undefined) as {
    t: NonNullable<ReturnType<typeof byId.get>>;
    uniqueUsers: number;
  }[];

  if (statusFilter) {
    rows = rows.filter((r) => r.t.status === statusFilter);
  }

  rows = rows.slice(0, limit);

  console.log(
    `ユニーク参加ユーザー数 TOP ${rows.length}${statusFilter ? `（status=${statusFilter}）` : ''}\n`
  );

  for (const [i, r] of rows.entries()) {
    const when =
      r.t.completedAt?.toISOString().slice(0, 16).replace('T', ' ') ??
      r.t.startedAt?.toISOString().slice(0, 16).replace('T', ' ') ??
      r.t.scheduledStartTime?.toISOString().slice(0, 16).replace('T', ' ') ??
      '?';
    console.log(
      `${String(i + 1).padStart(2)}. ${r.uniqueUsers}人  [${r.t.status}]  buyIn=${r.t.buyIn}  ${when}`
    );
    console.log(`     ${r.t.name}  (id: ${r.t.id})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
