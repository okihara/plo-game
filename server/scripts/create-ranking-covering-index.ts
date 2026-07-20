/// <reference types="node" />
/**
 * 日間/週間ランキング用のカバリングインデックスを CONCURRENTLY で作成し、ANALYZE する。
 *
 * インデックス名は schema.prisma の map 指定に合わせてあるため、
 * 実行後に db push しても再作成されない。
 *
 * 実行:
 *   cd server && npx tsx scripts/create-ranking-covering-index.ts --prod
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined,
);

const INDEX_NAME = 'HandHistoryPlayer_tid_createdAt_ranking_covering_idx';

async function main() {
  console.log(`対象DB: ${isProd ? '本番 (DATABASE_PROD_PUBLIC_URL)' : 'ローカル (DATABASE_URL)'}`);

  console.log(`作成中: ${INDEX_NAME} ...`);
  const start = Date.now();
  await prisma.$executeRawUnsafe(`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS "${INDEX_NAME}"
    ON "HandHistoryPlayer" ("tournamentId", "createdAt" DESC, "userId", "profit", "allInEVProfit")
  `);
  console.log(`  完了 (${((Date.now() - start) / 1000).toFixed(0)}s)`);

  // CONCURRENTLY が中断されると INVALID なインデックスが残るため検査する
  const invalid = await prisma.$queryRawUnsafe<Array<{ indexrelid: string }>>(
    `SELECT c.relname AS indexrelid
     FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
     WHERE NOT i.indisvalid AND c.relname LIKE 'HandHistoryPlayer_%'`,
  );
  if (invalid.length > 0) {
    console.error('WARNING: INVALID なインデックスがあります。DROP INDEX して再実行してください:', invalid);
    process.exit(1);
  }

  console.log('ANALYZE 実行中...');
  await prisma.$executeRawUnsafe(`ANALYZE "HandHistoryPlayer"`);
  console.log('完了');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
