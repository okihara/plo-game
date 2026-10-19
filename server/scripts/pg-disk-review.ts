/// <reference types="node" />
/**
 * Postgresのディスク使用量の内訳を確認するスクリプト（読み取り専用）
 * DB全体・テーブル別（TOAST/インデックス込み）・デッドタプル・WAL・レプリケーションスロット
 *
 * 実行:
 *   cd server && npx tsx scripts/pg-disk-review.ts          # ローカルDB
 *   cd server && npx tsx scripts/pg-disk-review.ts --prod   # 本番DB
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const isProd = process.argv.includes('--prod');

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
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

async function tryQuery<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.log(`  (${label} 取得不可: ${(e as Error).message.split('\n')[0]})`);
    return null;
  }
}

async function main() {
  const dbs = await prisma.$queryRaw<{ datname: string; size: string }[]>`
    SELECT datname, pg_size_pretty(pg_database_size(datname)) AS size
    FROM pg_database WHERE datistemplate = false
    ORDER BY pg_database_size(datname) DESC`;
  console.log('=== データベース別サイズ ===');
  for (const d of dbs) console.log(`  ${d.datname}: ${d.size}`);

  const tables = await prisma.$queryRaw<
    {
      relname: string;
      total: string;
      heap: string;
      toast: string;
      idx: string;
      live: bigint;
      dead: bigint;
      last_autovacuum: Date | null;
    }[]
  >`SELECT c.relname,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
        pg_size_pretty(pg_relation_size(c.oid)) AS heap,
        pg_size_pretty(COALESCE(pg_total_relation_size(NULLIF(c.reltoastrelid, 0)), 0)) AS toast,
        pg_size_pretty(pg_indexes_size(c.oid)) AS idx,
        COALESCE(s.n_live_tup, 0) AS live,
        COALESCE(s.n_dead_tup, 0) AS dead,
        s.last_autovacuum
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 15`;
  console.log('\n=== テーブル TOP15 (total = heap + toast + index) ===');
  for (const t of tables) {
    console.log(
      `  ${t.relname}: total=${t.total} heap=${t.heap} toast=${t.toast} idx=${t.idx}` +
        ` live=${t.live} dead=${t.dead} last_autovacuum=${t.last_autovacuum?.toISOString() ?? '-'}`,
    );
  }

  const indexes = await prisma.$queryRaw<
    { table: string; index: string; size: string; scans: bigint }[]
  >`SELECT s.relname AS table, s.indexrelname AS index,
        pg_size_pretty(pg_relation_size(s.indexrelid)) AS size, s.idx_scan AS scans
      FROM pg_stat_user_indexes s
      ORDER BY pg_relation_size(s.indexrelid) DESC
      LIMIT 15`;
  console.log('\n=== インデックス TOP15 (scans = 統計リセット以降の使用回数) ===');
  for (const i of indexes) console.log(`  ${i.table}.${i.index}: ${i.size} scans=${i.scans}`);

  console.log('\n=== WAL ===');
  await tryQuery('WAL', async () => {
    const wal = await prisma.$queryRaw<{ files: bigint; size: string }[]>`
      SELECT count(*) AS files, pg_size_pretty(COALESCE(sum(size), 0)) AS size FROM pg_ls_waldir()`;
    console.log(`  pg_wal: ${wal[0].size} (${wal[0].files} files)`);
  });
  const walSettings = await prisma.$queryRaw<{ name: string; setting: string; unit: string | null }[]>`
    SELECT name, setting, unit FROM pg_settings
    WHERE name IN ('max_wal_size','min_wal_size','wal_keep_size','max_slot_wal_keep_size','archive_mode')`;
  for (const s of walSettings) console.log(`  ${s.name}: ${s.setting}${s.unit ?? ''}`);

  console.log('\n=== レプリケーションスロット ===');
  await tryQuery('スロット', async () => {
    const slots = await prisma.$queryRaw<
      { slot_name: string; active: boolean; retained: string | null }[]
    >`SELECT slot_name, active,
          pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained
        FROM pg_replication_slots`;
    if (slots.length === 0) console.log('  なし');
    for (const s of slots) console.log(`  ${s.slot_name}: active=${s.active} retained=${s.retained}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
