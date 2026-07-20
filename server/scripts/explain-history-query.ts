/// <reference types="node" />
/**
 * ハンド履歴一覧クエリの EXPLAIN ANALYZE を確認する診断スクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/explain-history-query.ts <userId> --prod
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const userId = positional[0];

if (!userId) {
  console.error('ERROR: userId を指定してください');
  process.exit(1);
}
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined,
);

async function explain(label: string, sql: string) {
  console.log(`\n===== ${label} =====`);
  const rows = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
  );
  for (const r of rows) console.log(r['QUERY PLAN']);
}

async function main() {
  const sizes = await prisma.$queryRawUnsafe<Array<{ relname: string; n_live_tup: bigint }>>(
    `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE relname IN ('HandHistory', 'HandHistoryPlayer')`,
  );
  console.log('テーブル行数(推定):', sizes.map(s => `${s.relname}=${s.n_live_tup}`).join(', '));

  await explain('history list (order by hh.createdAt desc limit 20)', `
    SELECT hp."id"
    FROM "HandHistoryPlayer" hp
    JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
    WHERE hp."userId" = '${userId.replace(/'/g, "''")}'
    ORDER BY hh."createdAt" DESC
    LIMIT 20
  `);

  await explain('history count (cash filter)', `
    SELECT COUNT(*)
    FROM "HandHistoryPlayer" hp
    JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
    WHERE hp."userId" = '${userId.replace(/'/g, "''")}'
      AND hh."tournamentId" IS NULL
  `);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
