/// <reference types="node" />
/**
 * HandHistory / HandHistoryPlayer のインデックスを REINDEX CONCURRENTLY で作り直し、肥大化を解消する
 *
 * 大量 DELETE + VACUUM 後もインデックスのファイルサイズは縮まないため、作り直してディスクを OS に返す。
 * CONCURRENTLY なので読み書きはブロックしないが、テーブル本体を読み直すため実行中は I/O 負荷が上がる。
 * 新旧インデックスが一時的に並存するので、小さい順に1本ずつ処理する（空きが増えてから大きいものを作る）。
 *
 * 中断すると "_ccnew" / "_ccold" の無効インデックスが残るため、実行前に検出し、--apply 時は先に DROP する。
 *
 * 実行:
 *   cd server && npx tsx scripts/reindex-hand-history.ts --prod            # dry-run（対象一覧と残骸の検出のみ）
 *   cd server && npx tsx scripts/reindex-hand-history.ts --prod --apply    # 実行
 *   オプション: --only=<インデックス名>（1本だけ処理）
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const TABLES = ['HandHistoryPlayer', 'HandHistory'];

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

// SET をセッションに効かせるため接続を1本に固定する
function singleConnectionUrl(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}
const baseUrl = isProd ? process.env.DATABASE_PROD_PUBLIC_URL! : process.env.DATABASE_URL!;
const prisma = new PrismaClient({ datasources: { db: { url: singleConnectionUrl(baseUrl) } } });

type IndexRow = { name: string; table: string; bytes: bigint; valid: boolean };

async function listIndexes(): Promise<IndexRow[]> {
  return prisma.$queryRaw<IndexRow[]>`
    SELECT ic.relname AS name, tc.relname AS table,
      pg_relation_size(i.indexrelid) AS bytes, i.indisvalid AS valid
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    WHERE n.nspname = 'public' AND tc.relname = ANY(${TABLES})
    ORDER BY pg_relation_size(i.indexrelid) ASC`;
}

const isLeftover = (ix: IndexRow) => !ix.valid || /_cc(new|old)\d*$/.test(ix.name);
const mb = (b: bigint | number) => `${(Number(b) / 1024 / 1024).toFixed(0)} MB`;
const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function main() {
  console.log(
    `${isProd ? '🔗 本番DB' : '💻 ローカルDB'} / ` +
      `${apply ? '🔧 実行モード' : '👀 dry-run（変更しません。実行は --apply）'}\n`,
  );

  const all = await listIndexes();
  const leftovers = all.filter(isLeftover);
  const targets = all.filter((ix) => !isLeftover(ix) && (!only || ix.name === only));

  if (only && targets.length === 0) {
    console.error(`ERROR: --only=${only} に一致するインデックスがありません`);
    process.exit(1);
  }

  if (leftovers.length > 0) {
    console.log('⚠️  前回中断時の残骸（無効インデックス）:');
    for (const ix of leftovers) console.log(`  ${ix.table}.${ix.name}: ${mb(ix.bytes)} valid=${ix.valid}`);
    console.log('');
  }

  const totalBefore = targets.reduce((s, ix) => s + ix.bytes, 0n);
  console.log(`対象インデックス（小さい順、合計 ${mb(totalBefore)}）:`);
  for (const ix of targets) console.log(`  ${ix.table}.${ix.name}: ${mb(ix.bytes)}`);

  if (!apply) return;

  await prisma.$executeRawUnsafe('SET statement_timeout = 0');
  await prisma.$executeRawUnsafe("SET maintenance_work_mem = '256MB'");

  for (const ix of leftovers) {
    console.log(`\n🧹 DROP INDEX CONCURRENTLY ${ix.name}`);
    await prisma.$executeRawUnsafe(`DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdent(ix.name)}`);
  }

  const startedAll = Date.now();
  for (const ix of targets) {
    const started = Date.now();
    process.stdout.write(`\n▶ REINDEX ${ix.table}.${ix.name} (${mb(ix.bytes)}) ... `);
    await prisma.$executeRawUnsafe(`REINDEX INDEX CONCURRENTLY ${quoteIdent(ix.name)}`);
    const [after] = await prisma.$queryRaw<{ bytes: bigint }[]>`
      SELECT pg_relation_size(c.oid) AS bytes FROM pg_class c WHERE c.relname = ${ix.name}`;
    console.log(`${mb(after.bytes)} (${Math.round((Date.now() - started) / 1000)}s)`);
  }

  const afterAll = (await listIndexes()).filter((ix) => targets.some((t) => t.name === ix.name));
  const totalAfter = afterAll.reduce((s, ix) => s + ix.bytes, 0n);
  console.log(
    `\n完了 (${Math.round((Date.now() - startedAll) / 1000)}s): ${mb(totalBefore)} → ${mb(totalAfter)}` +
      `（${mb(totalBefore - totalAfter)} 削減）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
