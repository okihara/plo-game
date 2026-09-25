/// <reference types="node" />
/**
 * 指定ユーザー（displayName / username 部分一致）の直近トーナメント登録・リエントリー状況と
 * TOURNAMENT_BUY_IN 取引を表示する調査用スクリプト（読み取りのみ）
 *
 * 実行:
 *   cd server && npx tsx scripts/inspect-tournament-reentry.ts <名前> [--days=3] [--prod]
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const name = positional[0];
const daysArg = process.argv.find(a => a.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : 3;

if (!name) {
  console.error('ERROR: 名前を引数で指定してください');
  process.exit(1);
}
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const users = await prisma.user.findMany({
    where: { OR: [{ displayName: { contains: name } }, { username: { contains: name } }] },
    select: { id: true, username: true, displayName: true, role: true },
  });
  console.log('users:', users);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  for (const u of users) {
    console.log(`\n=== ${u.displayName ?? u.username} (${u.id}) role=${u.role} ===`);
    const regs = await prisma.tournamentRegistration.findMany({
      where: { userId: u.id, registeredAt: { gte: since } },
      include: { tournament: { select: { name: true, status: true, maxReentries: true, reentryDeadlineLevel: true, startedAt: true } } },
      orderBy: { registeredAt: 'asc' },
    });
    for (const r of regs) {
      const result = await prisma.tournamentResult.findUnique({
        where: { tournamentId_userId: { tournamentId: r.tournamentId, userId: u.id } },
        select: { position: true, prize: true, reentries: true, createdAt: true },
      });
      console.log({
        tournamentId: r.tournamentId,
        name: r.tournament.name,
        status: r.tournament.status,
        maxReentries: r.tournament.maxReentries,
        registeredAt: r.registeredAt,
        dbReentryCount: r.reentryCount,
        result,
      });
    }
    const txs = await prisma.transaction.findMany({
      where: { userId: u.id, createdAt: { gte: since }, type: { in: ['TOURNAMENT_BUY_IN', 'TOURNAMENT_PRIZE'] } },
      select: { type: true, amount: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    console.log('transactions:', txs);
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
