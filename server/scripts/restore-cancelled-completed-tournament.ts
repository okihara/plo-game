/// <reference types="node" />
/**
 * 完了後に誤って中止（CANCELLED）されたトナメを COMPLETED に戻す。
 * 2026-10-02 Daily（63CcZld65ciL）が完了後に running へ蘇生し、管理画面の「中止」で上書きされた件の復旧用。
 *
 *   cd server && npx tsx scripts/restore-cancelled-completed-tournament.ts --prod            # dry-run
 *   cd server && npx tsx scripts/restore-cancelled-completed-tournament.ts --prod --apply    # 書き込み
 *
 * 中止 API がバイインを返金した分（buyIn × (1 + reentryCount)）は一覧表示のみで、残高は触らない。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env'), quiet: true });

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');
const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

const TOURNAMENT_ID = '63CcZld65ciL';
/** 本番ログ「Tournament completed! Winner: ...」の時刻 */
const ORIGINAL_COMPLETED_AT = new Date('2026-10-02T14:34:41.672Z');

async function main() {
  const t = await prisma.tournament.findUnique({
    where: { id: TOURNAMENT_ID },
    select: { name: true, status: true, completedAt: true, buyIn: true, _count: { select: { results: true } } },
  });
  if (!t) throw new Error('tournament not found');
  console.log('現在:', t);

  const regs = await prisma.tournamentRegistration.findMany({
    where: { tournamentId: TOURNAMENT_ID },
    select: { userId: true, reentryCount: true, user: { select: { username: true, displayName: true } } },
  });
  const refunded = regs.map((r) => ({
    user: r.user.displayName ?? r.user.username,
    amount: t.buyIn * (1 + r.reentryCount),
  }));
  console.log(`中止時のバイイン返金: ${refunded.length}人 / 計 ${refunded.reduce((s, r) => s + r.amount, 0)}`);

  if (t.status !== 'CANCELLED') {
    console.log('CANCELLED ではないので何もしません');
    return;
  }
  if (!apply) {
    console.log(`[dry-run] status: CANCELLED → COMPLETED, completedAt: ${t.completedAt?.toISOString()} → ${ORIGINAL_COMPLETED_AT.toISOString()}`);
    return;
  }
  await prisma.tournament.update({
    where: { id: TOURNAMENT_ID },
    data: { status: 'COMPLETED', completedAt: ORIGINAL_COMPLETED_AT },
  });
  console.log('COMPLETED に戻しました');
}

main().finally(() => prisma.$disconnect());
