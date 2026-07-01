/// <reference types="node" />
/**
 * シーズン結果を一度だけ集計し、SeasonSnapshot に固定保存する。
 * シーズン終了後（データ確定後）に実行する。以後 /api/season はこの結果を即返す。
 *
 *   # 本番データを集計して本番DBに保存（本番運用）
 *   cd server && npx tsx scripts/generate-season-snapshot.ts --prod
 *
 *   # 本番データを集計してローカルDBに保存（ローカルで /season をテストしたいとき）
 *   cd server && npx tsx scripts/generate-season-snapshot.ts --from-prod
 *
 *   # ローカルデータを集計してローカルDBに保存（フラグなし）
 *   cd server && npx tsx scripts/generate-season-snapshot.ts
 *
 * 既存スナップショットがある場合は上書き更新する。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';
import { buildSeasonPayload } from '../src/modules/season/buildSeasonPayload.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');       // 集計=本番 / 保存=本番
const fromProd = process.argv.includes('--from-prod'); // 集計=本番 / 保存=ローカル（テスト用）

const sourceUsesProd = isProd || fromProd;
if (sourceUsesProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に未設定です');
  process.exit(1);
}

// 集計元（source）。--prod / --from-prod のときは本番、それ以外はローカル既定。
const sourcePrisma = new PrismaClient({
  datasources: sourceUsesProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});
// 保存先（target）。--from-prod のときだけローカル、それ以外は source と同じDB。
const targetPrisma = fromProd ? new PrismaClient() : sourcePrisma;

console.error(`集計元: ${sourceUsesProd ? '本番DB' : 'ローカルDB'} / 保存先: ${isProd ? '本番DB' : 'ローカルDB'}`);

async function main() {
  console.log(`シーズン「${CURRENT_SEASON.name}」(${CURRENT_SEASON.label}) を集計中...`);
  const t0 = Date.now();
  const payload = await buildSeasonPayload(sourcePrisma);
  console.log(`集計完了 (${Math.round((Date.now() - t0) / 1000)}秒)`);
  console.log(
    `  ランクイン ${payload.stats.rankedPlayers}人 / 完了トナメ ${payload.stats.tournaments}本 / ハンド走査 ${payload.stats.handsScanned.toLocaleString()}`,
  );
  console.log('  受賞者:');
  for (const a of payload.awards) {
    console.log(`    ${a.emoji} ${a.title} → ${a.winner ? `${a.winner.name} (${a.winner.valueLabel})` : '該当者なし'}`);
  }

  await targetPrisma.seasonSnapshot.upsert({
    where: { seasonName: CURRENT_SEASON.name },
    create: { seasonName: CURRENT_SEASON.name, data: payload as unknown as object },
    update: { data: payload as unknown as object, generatedAt: new Date() },
  });
  console.log(`\n${isProd ? '本番' : 'ローカル'}の SeasonSnapshot に保存しました（seasonName="${CURRENT_SEASON.name}"）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await sourcePrisma.$disconnect();
    if (targetPrisma !== sourcePrisma) await targetPrisma.$disconnect();
  });
