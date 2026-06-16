/// <reference types="node" />
/**
 * 告知ツイート用に「直近で終わったトナメ」の最小サマリを JSON で出力する。
 *
 *   cd server && npx tsx scripts/tournament-announce-data.ts --prod
 *
 * 出力には優勝者名・エントリー数・経過時間しか含めない。
 * 直近の COMPLETED が48時間より古ければ stale=true で返す（呼び出し側で省略する想定）。
 *
 * 集計ロジックは src/modules/tweet/data/announceData.ts に移してあり、
 * このスクリプトは CLI 入出力だけを担当する。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { fetchPreviousResult } from '../src/modules/tweet/data/announceData.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const summary = await fetchPreviousResult(prisma);
  if (!summary) {
    console.log(JSON.stringify({ tournament: null }, null, 2));
    return;
  }
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
