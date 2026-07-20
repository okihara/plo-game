/// <reference types="node" />
/**
 * HandHistoryPlayer 非正規化カラム用の複合インデックスを CONCURRENTLY で作成し、ANALYZE する。
 * backfill-hhp-denorm.ts の完了後に実行する（バックフィル中に作るとインデックス更新分だけ遅くなる）。
 *
 * インデックス名は prisma db push が生成する規約に合わせてあるため、
 * 実行後に db push しても再作成されない。
 *
 * 実行:
 *   cd server && npx tsx scripts/create-hhp-denorm-indexes.ts --prod
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

const INDEXES: Array<{ name: string; ddl: string }> = [
  {
    name: 'HandHistoryPlayer_userId_createdAt_idx',
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "HandHistoryPlayer_userId_createdAt_idx"
          ON "HandHistoryPlayer" ("userId", "createdAt" DESC)`,
  },
  {
    name: 'HandHistoryPlayer_userId_tournamentId_createdAt_idx',
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "HandHistoryPlayer_userId_tournamentId_createdAt_idx"
          ON "HandHistoryPlayer" ("userId", "tournamentId", "createdAt" DESC)`,
  },
];

async function main() {
  console.log(`対象DB: ${isProd ? '本番 (DATABASE_PROD_PUBLIC_URL)' : 'ローカル (DATABASE_URL)'}`);

  for (const idx of INDEXES) {
    console.log(`作成中: ${idx.name} ...`);
    const start = Date.now();
    await prisma.$executeRawUnsafe(idx.ddl);
    console.log(`  完了 (${((Date.now() - start) / 1000).toFixed(0)}s)`);
  }

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
  await prisma.$executeRawUnsafe(`ANALYZE "HandHistory"`);
  console.log('完了');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
