/// <reference types="node" />
/**
 * 結果ツイート用のトーナメントデータを JSON で出力する。
 *
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod --tournament <id>
 *
 * --tournament を省略すると「最新の COMPLETED トナメ」を対象にする。
 *
 * 集計ロジックは src/modules/tweet/data/resultData.ts に移してあり、
 * このスクリプトは CLI 入出力だけを担当する。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { fetchResultData } from '../src/modules/tweet/data/resultData.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const tIdx = process.argv.indexOf('--tournament');
const tournamentIdArg = tIdx >= 0 ? process.argv[tIdx + 1] : undefined;
const handsIdx = process.argv.indexOf('--hands');
const handsLimit = handsIdx >= 0 ? Number(process.argv[handsIdx + 1]) : 50;

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
  const bundle = await fetchResultData(prisma, { tournamentId: tournamentIdArg, handsLimit });
  if (!bundle) {
    console.error('対象のトナメが見つかりません');
    process.exit(1);
  }
  console.error(
    `対象トナメ: ${bundle.tournament.name} (${bundle.tournament.id}) status=${bundle.tournament.status}`,
  );
  console.log(JSON.stringify(bundle, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
