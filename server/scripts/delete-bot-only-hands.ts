/// <reference types="node" />
/**
 * Bot しか参加していないリングゲームの古いハンド履歴を削除する（ディスク容量対策）
 *
 * 対象: tournamentId IS NULL かつ createdAt < (現在 - days) で、
 *       HandHistoryPlayer が全員 User.provider = 'bot' のハンド。
 *       userId が NULL の席や人間が1人でもいるハンドは残す。
 *
 * HandHistory を (createdAt, id) のキーセットで batch 件ずつ走査し、対象だけを
 * HandHistoryPlayer → HandHistory の順に1トランザクションで削除する。
 * 削除後の領域は Postgres 内で再利用されるだけで、ボリューム使用量は VACUUM FULL / REINDEX まで減らない。
 *
 * 実行:
 *   cd server && npx tsx scripts/delete-bot-only-hands.ts --prod                # dry-run（件数のみ）
 *   cd server && npx tsx scripts/delete-bot-only-hands.ts --prod --apply        # 実削除
 *   オプション: --days=30 --batch=2000 --sleep-ms=200 --max-batches=N --vacuum（--apply 時に最後に VACUUM ANALYZE）
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, Prisma } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

function numArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`ERROR: --${name} は正の数で指定してください`);
    process.exit(1);
  }
  return n;
}

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');
const vacuum = process.argv.includes('--vacuum');
const days = numArg('days', 30);
const batchSize = numArg('batch', 2000);
const sleepMs = numArg('sleep-ms', 200);
const maxBatches = numArg('max-batches', Number.MAX_SAFE_INTEGER);

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  console.log(
    `${apply ? '🗑️  削除モード' : '👀 dry-run（削除しません。実行は --apply）'}` +
      ` cutoff=${cutoff.toISOString()} (${days}日前) batch=${batchSize}\n`,
  );

  let cursorAt = new Date(0);
  let cursorId = '';
  let scanned = 0;
  let targetHands = 0;
  let deletedPlayers = 0;
  let batches = 0;
  const startedAt = Date.now();

  while (batches < maxBatches) {
    const rows = await prisma.$queryRaw<{ id: string; createdAt: Date; bot_only: boolean }[]>(Prisma.sql`
      WITH scanned AS (
        SELECT id, "createdAt" FROM "HandHistory"
        WHERE "tournamentId" IS NULL
          AND "createdAt" < ${cutoff}
          AND "createdAt" >= ${cursorAt}
          AND ("createdAt" > ${cursorAt} OR id > ${cursorId})
        ORDER BY "createdAt", id
        LIMIT ${batchSize}
      )
      SELECT s.id, s."createdAt",
        NOT EXISTS (
          SELECT 1 FROM "HandHistoryPlayer" p
          LEFT JOIN "User" u ON u.id = p."userId"
          WHERE p."handHistoryId" = s.id AND u.provider IS DISTINCT FROM 'bot'
        ) AS bot_only
      FROM scanned s
      ORDER BY s."createdAt", s.id
    `);
    if (rows.length === 0) break;

    batches++;
    scanned += rows.length;
    const last = rows[rows.length - 1];
    cursorAt = last.createdAt;
    cursorId = last.id;

    const ids = rows.filter((r) => r.bot_only).map((r) => r.id);
    targetHands += ids.length;

    if (apply && ids.length > 0) {
      const [players] = await prisma.$transaction([
        prisma.handHistoryPlayer.deleteMany({ where: { handHistoryId: { in: ids } } }),
        prisma.handHistory.deleteMany({ where: { id: { in: ids } } }),
      ]);
      deletedPlayers += players.count;
    }

    if (batches % 25 === 0) {
      const sec = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `  [${sec}s] batch=${batches} 走査=${scanned.toLocaleString()} 対象=${targetHands.toLocaleString()}` +
          ` 位置=${cursorAt.toISOString()}`,
      );
    }
    if (apply) await sleep(sleepMs);
  }

  const sec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n完了 (${sec}s, ${batches} batches)`);
  console.log(`  走査したリングハンド: ${scanned.toLocaleString()}`);
  console.log(`  bot のみのハンド:     ${targetHands.toLocaleString()}${apply ? '（削除済み）' : '（dry-run: 未削除）'}`);
  if (apply) console.log(`  削除した HandHistoryPlayer 行: ${deletedPlayers.toLocaleString()}`);

  if (apply && vacuum) {
    console.log('\nVACUUM (ANALYZE) を実行中...');
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "HandHistoryPlayer"');
    await prisma.$executeRawUnsafe('VACUUM (ANALYZE) "HandHistory"');
    console.log('  完了');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
