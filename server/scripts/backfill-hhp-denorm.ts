/// <reference types="node" />
/**
 * HandHistoryPlayer の非正規化カラム (tournamentId / createdAt) の追加とバックフィル
 *
 * 背景: ユーザー単位のハンド履歴・収支クエリが HandHistory への JOIN を必要とし、
 * ハンド数が数万を超えるユーザー（例: 77k ハンド）で30秒超かかっていた。
 * ソート・絞り込みキーを HandHistoryPlayer 側に持たせて JOIN を不要にする。
 *
 * 実行手順（本番）:
 *   1. npx tsx scripts/backfill-hhp-denorm.ts --add-columns --prod   # カラム追加のみ（瞬時）
 *   2. 新コードをデプロイ（以降の新規ハンドは書き込み時に埋まる）
 *   3. npx tsx scripts/backfill-hhp-denorm.ts --prod                 # 全行バックフィル（19M行、10-20分）
 *   4. npx tsx scripts/create-hhp-denorm-indexes.ts --prod           # インデックス作成 + ANALYZE
 *   5. npx tsx scripts/backfill-hhp-denorm.ts --recent 48 --prod     # 取りこぼし確認（デプロイ前後の隙間）
 *
 * ローカル: npm run db:push でスキーマ反映後、--prod なしで実行
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const addColumnsOnly = process.argv.includes('--add-columns');
const recentIdx = process.argv.indexOf('--recent');
const recentHours = recentIdx >= 0 ? Number(process.argv[recentIdx + 1]) : null;
const cursorIdx = process.argv.indexOf('--cursor');
const startCursor = cursorIdx >= 0 ? process.argv[cursorIdx + 1] : '';
const maxMinutesIdx = process.argv.indexOf('--max-minutes');
const maxMinutes = maxMinutesIdx >= 0 ? Number(process.argv[maxMinutesIdx + 1]) : null;

const BATCH_SIZE = 10_000;

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}
if (recentIdx >= 0 && (!recentHours || recentHours <= 0)) {
  console.error('ERROR: --recent には正の時間数を指定してください（例: --recent 48）');
  process.exit(1);
}

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined,
);

async function addColumns() {
  // schema.prisma と同じ型 (TEXT / TIMESTAMP(3)) で追加。既にあれば no-op。
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HandHistoryPlayer" ADD COLUMN IF NOT EXISTS "tournamentId" TEXT`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "HandHistoryPlayer" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3)`,
  );
  console.log('カラム追加完了 (tournamentId, createdAt)');
}

/** 主キーカーソルで全行を舐め、createdAt が NULL の行だけ親から埋める */
async function backfillFull() {
  let cursor = startCursor;
  let scanned = 0;
  let updated = 0;
  const startedAt = Date.now();

  for (;;) {
    if (maxMinutes && Date.now() - startedAt > maxMinutes * 60_000) {
      console.log(`制限時間 ${maxMinutes} 分に到達。再開するには: --cursor ${cursor}`);
      return;
    }
    const boundary = await prisma.$queryRawUnsafe<Array<{ max_id: string | null; cnt: bigint }>>(
      `SELECT max(id) AS max_id, count(*) AS cnt
       FROM (SELECT id FROM "HandHistoryPlayer" WHERE id > $1 ORDER BY id LIMIT $2) s`,
      cursor,
      BATCH_SIZE,
    );
    const maxId = boundary[0]?.max_id;
    const cnt = Number(boundary[0]?.cnt ?? 0);
    if (!maxId || cnt === 0) break;

    const changed = await prisma.$executeRawUnsafe(
      `UPDATE "HandHistoryPlayer" hp
       SET "tournamentId" = hh."tournamentId", "createdAt" = hh."createdAt"
       FROM "HandHistory" hh
       WHERE hp."handHistoryId" = hh.id
         AND hp.id > $1 AND hp.id <= $2
         AND hp."createdAt" IS NULL`,
      cursor,
      maxId,
    );

    scanned += cnt;
    updated += changed;
    cursor = maxId;

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    console.log(`scanned=${scanned} updated=${updated} elapsed=${elapsed}s cursor=${cursor}`);
  }

  console.log(`バックフィル完了: scanned=${scanned}, updated=${updated}`);
}

/** 直近 N 時間の HandHistory に紐づく未バックフィル行だけ埋める（デプロイ隙間の取りこぼし用） */
async function backfillRecent(hours: number) {
  const updated = await prisma.$executeRawUnsafe(
    `UPDATE "HandHistoryPlayer" hp
     SET "tournamentId" = hh."tournamentId", "createdAt" = hh."createdAt"
     FROM "HandHistory" hh
     WHERE hp."handHistoryId" = hh.id
       AND hh."createdAt" > now() - ($1 || ' hours')::interval
       AND hp."createdAt" IS NULL`,
    String(hours),
  );
  console.log(`直近${hours}時間の取りこぼしバックフィル完了: updated=${updated}`);
}

async function main() {
  console.log(`対象DB: ${isProd ? '本番 (DATABASE_PROD_PUBLIC_URL)' : 'ローカル (DATABASE_URL)'}`);
  await addColumns();
  if (addColumnsOnly) return;

  if (recentHours) {
    await backfillRecent(recentHours);
  } else {
    await backfillFull();
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
