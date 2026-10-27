/// <reference types="node" />
/**
 * 過去のプライベート卓（練習卓を含む）のハンドに HandHistory.isPrivate = true を付ける。
 * 履歴には卓の種類が残っていないため、次の条件で推定する:
 *   - トナメ外
 *   - プライベート卓に入れた期間（2026-03-01〜03-23 にロビーの入口を非表示、2026-08-17〜）
 *   - その卓で Bot が一度も座っていない（ファストフォールド卓には Bot が入る）
 *   - isPrivate を記録し始める前のハンド（それ以降は記録が正しいので触らない）
 *     終わりは --until、省略時は isPrivate = true のハンドが最初に記録された時刻
 *
 * 実行:
 *   cd server && npx tsx scripts/backfill-private-hands.ts --prod                           # 本番DB（件数確認のみ）
 *   cd server && npx tsx scripts/backfill-private-hands.ts --prod --until=2026-10-28T12:00+09:00  # 終わりを指定
 *   cd server && npx tsx scripts/backfill-private-hands.ts --prod --apply                   # 本番DBに適用
 */
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(import.meta.dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');
const untilArg = process.argv.find(a => a.startsWith('--until='))?.slice('--until='.length);

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

const CANDIDATE_TABLES = `
  SELECT h."tableId"
  FROM "HandHistory" h
  JOIN "HandHistoryPlayer" p ON p."handHistoryId" = h.id
  LEFT JOIN "User" u ON u.id = p."userId"
  WHERE h."tournamentId" IS NULL
    AND ((h."createdAt" >= '2026-03-01' AND h."createdAt" < '2026-03-24') OR h."createdAt" >= '2026-08-17')
    AND h."createdAt" < $1
  GROUP BY h."tableId"
  HAVING bool_and(u.provider IS DISTINCT FROM 'bot')`;

/** isPrivate を記録し始めた時刻。--until があればそれを使う */
async function resolveUntil(): Promise<Date | null> {
  if (untilArg) {
    const d = new Date(untilArg);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const first = await prisma.handHistory.findFirst({
    where: { isPrivate: true },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  return first?.createdAt ?? null;
}

async function main() {
  const until = await resolveUntil();
  if (!until) {
    console.error('ERROR: 終わりの時刻を決められません。--until=<ISO日時> を指定してください');
    process.exitCode = 1;
    return;
  }
  console.log(`対象: ${until.toISOString()} より前のハンド\n`);

  const rows = await prisma.$queryRawUnsafe<{ month: string; tables: number; hands: number }[]>(`
    SELECT to_char(h."createdAt", 'YYYY-MM') AS month,
      count(DISTINCT h."tableId")::int AS tables, count(*)::int AS hands
    FROM "HandHistory" h
    WHERE h."createdAt" < $1 AND h."tableId" IN (${CANDIDATE_TABLES})
    GROUP BY 1 ORDER BY 1`, until);
  console.log('isPrivate を付ける候補（月別）');
  for (const r of rows) console.log(`  ${r.month}  卓 ${r.tables}  ハンド ${r.hands}`);
  console.log(`  合計ハンド ${rows.reduce((s, r) => s + r.hands, 0)}`);

  if (!apply) {
    console.log('\n--apply なしのため更新していません');
    return;
  }
  const updated = await prisma.$executeRawUnsafe(`
    UPDATE "HandHistory" SET "isPrivate" = true
    WHERE "isPrivate" = false AND "createdAt" < $1 AND "tableId" IN (${CANDIDATE_TABLES})`, until);
  console.log(`\n更新: ${updated} ハンド`);
}

main().finally(() => prisma.$disconnect());
