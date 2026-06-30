/// <reference types="node" />
/**
 * シーズン結果を一度だけ集計し、SeasonSnapshot に固定保存する。
 * シーズン終了後（データ確定後）に実行する。以後 /api/season はこの結果を即返す。
 *
 *   cd server && npx tsx scripts/generate-season-snapshot.ts --prod
 *
 * 既存スナップショットがある場合は上書き更新する（--prod なしならローカルDB）。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';
import { buildSeasonPayload } from '../src/modules/season/buildSeasonPayload.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に未設定です');
  process.exit(1);
}
if (isProd) console.error('本番DBに接続します');

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  console.log(`シーズン「${CURRENT_SEASON.name}」(${CURRENT_SEASON.label}) を集計中...`);
  const t0 = Date.now();
  const payload = await buildSeasonPayload(prisma);
  console.log(`集計完了 (${Math.round((Date.now() - t0) / 1000)}秒)`);
  console.log(
    `  ランクイン ${payload.stats.rankedPlayers}人 / 完了トナメ ${payload.stats.tournaments}本 / ハンド走査 ${payload.stats.handsScanned.toLocaleString()}`,
  );
  console.log('  受賞者:');
  for (const a of payload.awards) {
    console.log(`    ${a.emoji} ${a.title} → ${a.winner ? `${a.winner.name} (${a.winner.valueLabel})` : '該当者なし'}`);
  }

  await prisma.seasonSnapshot.upsert({
    where: { seasonName: CURRENT_SEASON.name },
    create: { seasonName: CURRENT_SEASON.name, data: payload as unknown as object },
    update: { data: payload as unknown as object, generatedAt: new Date() },
  });
  console.log(`\nSeasonSnapshot に保存しました（seasonName="${CURRENT_SEASON.name}"）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
