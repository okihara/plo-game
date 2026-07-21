/// <reference types="node" />
/**
 * Postgresのメモリ関連設定・キャッシュヒット率・テーブルサイズを確認するスクリプト
 * （メモリ上限キャップの影響見積もり用）
 *
 * 実行:
 *   cd server && npx tsx scripts/pg-memory-review.ts          # ローカルDB
 *   cd server && npx tsx scripts/pg-memory-review.ts --prod   # 本番DB
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const isProd = process.argv.includes('--prod');

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
  const settings = await prisma.$queryRaw<
    { name: string; setting: string; unit: string | null }[]
  >`SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('shared_buffers','effective_cache_size','work_mem','maintenance_work_mem','max_connections','max_wal_size')`;
  console.log('=== メモリ関連設定 ===');
  for (const s of settings) {
    console.log(`  ${s.name}: ${s.setting}${s.unit ?? ''}`);
  }

  const dbSize = await prisma.$queryRaw<{ size: string }[]>`
    SELECT pg_size_pretty(pg_database_size(current_database())) AS size`;
  console.log(`\n=== DBサイズ: ${dbSize[0].size} ===`);

  const tables = await prisma.$queryRaw<
    { relname: string; total: string; table_size: string; index_size: string }[]
  >`SELECT relname,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
        pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
        pg_size_pretty(pg_indexes_size(c.oid)) AS index_size
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 12`;
  console.log('\n=== テーブルサイズ TOP12 (インデックス込み) ===');
  for (const t of tables) {
    console.log(`  ${t.relname}: total=${t.total} (table=${t.table_size}, index=${t.index_size})`);
  }

  const hit = await prisma.$queryRaw<
    { blks_read: bigint; blks_hit: bigint; stats_reset: Date | null }[]
  >`SELECT blks_read, blks_hit, stats_reset FROM pg_stat_database WHERE datname = current_database()`;
  const read = Number(hit[0].blks_read);
  const cached = Number(hit[0].blks_hit);
  const ratio = cached / Math.max(1, cached + read);
  console.log('\n=== shared_buffers キャッシュヒット率 ===');
  console.log(`  hit=${cached} read=${read} ratio=${(ratio * 100).toFixed(2)}%`);
  console.log(`  (統計リセット: ${hit[0].stats_reset ?? '不明'})`);

  const conns = await prisma.$queryRaw<{ cnt: bigint; max_seen: string | null }[]>`
    SELECT count(*) AS cnt, NULL AS max_seen FROM pg_stat_activity`;
  console.log(`\n=== 現在の接続数: ${conns[0].cnt} ===`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
