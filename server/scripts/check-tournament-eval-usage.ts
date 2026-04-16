/// <reference types="node" />
/**
 * AIレビュー（トーナメント評価）の利用状況を集計する。
 *
 *   cd server && npx tsx scripts/check-tournament-eval-usage.ts --prod
 *   cd server && npx tsx scripts/check-tournament-eval-usage.ts --prod --details
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const showDetails = process.argv.includes('--details');

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
  const [byStatus, consumedQuotaUserList, pendingRows, byUser] = await Promise.all([
    prisma.tournamentUserEvaluation.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { tournamentEvalConsumedJstDate: { not: null } },
      select: {
        id: true,
        username: true,
        displayName: true,
        tournamentEvalConsumedJstDate: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.tournamentUserEvaluation.findMany({
      where: { status: 'PENDING' },
      select: {
        id: true,
        userId: true,
        tournamentId: true,
        createdAt: true,
        user: { select: { username: true, displayName: true } },
        tournament: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.tournamentUserEvaluation.groupBy({
      by: ['userId', 'status'],
      _count: { _all: true },
    }),
  ]);

  console.log('--- TournamentUserEvaluation（件数・ステータス別）---');
  for (const row of byStatus.sort((a, b) => a.status.localeCompare(b.status))) {
    console.log(`  ${row.status}: ${row._count._all}`);
  }
  const evalTotal = byStatus.reduce((s, r) => s + r._count._all, 0);
  console.log(`  合計: ${evalTotal}`);

  console.log('--- 日次クォータを一度でも消費したユーザー（tournamentEvalConsumedJstDate が非null）---');
  console.log(`  人数: ${consumedQuotaUserList.length}`);
  for (const u of consumedQuotaUserList) {
    const name = u.displayName || u.username;
    console.log(
      `  userId=${u.id} | ${name} | lastConsumedJstDate=${u.tournamentEvalConsumedJstDate}`
    );
  }

  const userIds = Array.from(new Set(byUser.map((r) => r.userId)));
  const usersForCount = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, displayName: true },
  });
  const userMap = new Map(usersForCount.map((u) => [u.id, u]));

  type UserUsage = { userId: string; name: string; total: number; byStatus: Record<string, number> };
  const usageByUser = new Map<string, UserUsage>();
  for (const row of byUser) {
    const u = userMap.get(row.userId);
    const name = u ? u.displayName || u.username : '(unknown)';
    const entry = usageByUser.get(row.userId) ?? { userId: row.userId, name, total: 0, byStatus: {} };
    entry.byStatus[row.status] = (entry.byStatus[row.status] ?? 0) + row._count._all;
    entry.total += row._count._all;
    usageByUser.set(row.userId, entry);
  }
  const usageList = Array.from(usageByUser.values()).sort((a, b) => b.total - a.total);

  console.log('--- ユーザー別の利用回数（多い順）---');
  console.log(`  人数: ${usageList.length}`);
  for (const u of usageList) {
    const breakdown = Object.entries(u.byStatus)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([s, c]) => `${s}=${c}`)
      .join(', ');
    console.log(`  ${u.total}回 | userId=${u.userId} | ${u.name} | ${breakdown}`);
  }

  console.log('--- 現在 PENDING の行 ---');
  console.log(`  件数: ${pendingRows.length}`);
  for (const r of pendingRows) {
    const name = r.user.displayName || r.user.username;
    console.log(
      `  ${r.createdAt.toISOString()} | userId=${r.userId} | ${name} | tournament=${r.tournament.name} (${r.tournamentId})`
    );
  }

  if (!showDetails) return;

  const rows = await prisma.tournamentUserEvaluation.findMany({
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      status: true,
      createdAt: true,
      userId: true,
      tournamentId: true,
      user: { select: { username: true, displayName: true } },
      tournament: { select: { name: true } },
    },
  });

  console.log('\n--- 評価レコード一覧（最新200件）---');
  for (const r of rows) {
    const name = r.user.displayName || r.user.username;
    console.log(
      `  ${r.createdAt.toISOString()} | ${r.status} | userId=${r.userId} | ${name} | tournament=${r.tournament.name} (${r.tournamentId})`
    );
  }

}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
