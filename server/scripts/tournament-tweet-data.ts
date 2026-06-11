/// <reference types="node" />
/**
 * 結果ツイート用のトーナメントデータを JSON で出力する。
 *
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod --tournament <id>
 *
 * --tournament を省略すると「最新の COMPLETED トナメ」を対象にする。
 * データ取得本体は src/modules/tournament/tweet/fetchTweetData.ts（共通化済み）。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { fetchTournamentTweetData } from '../src/modules/tournament/tweet/fetchTweetData.js';

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
  const data = await fetchTournamentTweetData(prisma, {
    tournamentId: tournamentIdArg,
    handsLimit,
  });

  if (!data) {
    console.error('対象のトナメが見つかりません');
    process.exit(1);
  }
  console.error(
    `対象トナメ: ${data.tournament.name} (${data.tournament.id}) status=${data.tournament.status}`,
  );

  console.log(JSON.stringify(data, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
