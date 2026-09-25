/// <reference types="node" />
/**
 * 課金されたのに卓に復帰しなかったリエントリーを返金するスクリプト
 *
 * 対象: 終了済みトーナメントで TournamentRegistration.reentryCount（課金回数）が
 *       TournamentResult.reentries（実際に復帰した回数）より多い参加者
 *
 * 1ユーザー×1トーナメントごとに1トランザクションで:
 *   - Bankroll に buyIn × 差分 を加算
 *   - Transaction に TOURNAMENT_BUY_IN の正の金額（バイインの取り消し）を記録
 *   - reentryCount を実際の復帰回数に合わせる（再実行しても二重返金しない）
 *
 * 実行:
 *   cd server && npx tsx scripts/refund-unapplied-reentries.ts --prod            # 対象の確認のみ（dry-run）
 *   cd server && npx tsx scripts/refund-unapplied-reentries.ts --prod --execute  # 返金を実行
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const execute = process.argv.includes('--execute');

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

type Target = {
  tournamentId: string;
  tournamentName: string;
  buyIn: number;
  userId: string;
  displayName: string | null;
  username: string;
  paidReentries: number;
  appliedReentries: number;
};

async function findTargets(): Promise<Target[]> {
  return prisma.$queryRaw<Target[]>`
    SELECT t.id AS "tournamentId", t.name AS "tournamentName", t."buyIn" AS "buyIn",
           u.id AS "userId", u."displayName" AS "displayName", u.username AS "username",
           r."reentryCount" AS "paidReentries", res.reentries AS "appliedReentries"
    FROM "TournamentRegistration" r
    JOIN "TournamentResult" res ON res."tournamentId" = r."tournamentId" AND res."userId" = r."userId"
    JOIN "Tournament" t ON t.id = r."tournamentId"
    JOIN "User" u ON u.id = r."userId"
    WHERE t.status = 'COMPLETED' AND r."reentryCount" > res.reentries
    ORDER BY t."createdAt" ASC`;
}

async function refund(target: Target): Promise<number> {
  const diff = target.paidReentries - target.appliedReentries;
  const amount = target.buyIn * diff;
  await prisma.$transaction(async (tx) => {
    // 読み取り時の回数を条件にして、並行実行や再実行での二重返金を防ぐ
    const updated = await tx.tournamentRegistration.updateMany({
      where: {
        tournamentId: target.tournamentId,
        userId: target.userId,
        reentryCount: target.paidReentries,
      },
      data: { reentryCount: target.appliedReentries },
    });
    if (updated.count === 0) throw new Error('reentryCount が変わっているため中止');

    await tx.bankroll.update({
      where: { userId: target.userId },
      data: { balance: { increment: amount } },
    });
    await tx.transaction.create({
      data: { userId: target.userId, type: 'TOURNAMENT_BUY_IN', amount },
    });
  });
  return amount;
}

async function main() {
  console.log(`🔗 ${isProd ? '本番' : 'ローカル'}DB / ${execute ? '返金を実行' : 'dry-run（書き込みなし）'}\n`);

  const running = await prisma.tournament.findMany({
    where: { status: 'RUNNING' },
    select: { name: true, status: true },
  });
  console.log('進行中のトーナメント:', running.length === 0 ? 'なし' : running);

  const targets = await findTargets();
  console.table(targets.map(t => ({
    tournament: t.tournamentName,
    player: t.displayName ?? t.username,
    paid: t.paidReentries,
    applied: t.appliedReentries,
    refund: t.buyIn * (t.paidReentries - t.appliedReentries),
  })));
  const total = targets.reduce((sum, t) => sum + t.buyIn * (t.paidReentries - t.appliedReentries), 0);
  console.log(`対象 ${targets.length} 件 / 返金合計 ${total.toLocaleString()} chips`);

  if (!execute) {
    console.log('\ndry-run のため書き込みはしていません。実行するには --execute を付けてください。');
    return;
  }

  let done = 0;
  for (const t of targets) {
    try {
      const amount = await refund(t);
      done++;
      console.log(`✅ ${t.displayName ?? t.username} / ${t.tournamentName}: +${amount}`);
    } catch (err) {
      console.error(`❌ ${t.displayName ?? t.username} / ${t.tournamentName}:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\n完了: ${done}/${targets.length} 件`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
