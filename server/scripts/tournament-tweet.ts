/// <reference types="node" />
/**
 * トーナメント結果ツイートを自動生成し、（指定時のみ）X に投稿する。
 *
 * デフォルトは dry-run（文面を stdout に出すだけ。投稿しない）:
 *   cd server && npx tsx scripts/tournament-tweet.ts --prod
 *   cd server && npx tsx scripts/tournament-tweet.ts --prod --tournament <id>
 *   cd server && npx tsx scripts/tournament-tweet.ts --prod --lead "休みの中"
 *
 * 実際に投稿する場合のみ --post を付ける:
 *   cd server && npx tsx scripts/tournament-tweet.ts --prod --post
 *
 * 必要な環境変数（server/.env。値をログ・会話に出さない）:
 *   DATABASE_PROD_PUBLIC_URL（--prod 時）
 *   TWITTER_API_KEY, TWITTER_API_KEY_SECRET,
 *   TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET（--post 時）
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { fetchTournamentTweetData } from '../src/modules/tournament/tweet/fetchTweetData.js';
import {
  buildResultTweet,
  estimateTweetWeight,
} from '../src/modules/tournament/tweet/buildResultTweet.js';
import { postTweet, getCredentialsFromEnv } from '../src/shared/twitterClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
const isProd = args.includes('--prod');
const shouldPost = args.includes('--post');
const tIdx = args.indexOf('--tournament');
const tournamentIdArg = tIdx >= 0 ? args[tIdx + 1] : undefined;
const leadIdx = args.indexOf('--lead');
const entriesLead = leadIdx >= 0 ? args[leadIdx + 1] : undefined;

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
  const data = await fetchTournamentTweetData(prisma, { tournamentId: tournamentIdArg });

  if (!data) {
    console.error('対象のトナメが見つかりません');
    process.exit(1);
  }

  const { tournament } = data;
  console.error(`対象トナメ: ${tournament.name} (${tournament.id}) status=${tournament.status}`);

  if (tournament.status !== 'COMPLETED') {
    console.error(`ERROR: トナメが COMPLETED ではありません (status=${tournament.status})`);
    process.exit(1);
  }

  const text = buildResultTweet(data, { entriesLead });
  const weight = estimateTweetWeight(text);

  console.error('--- ツイート文面 ---');
  console.log(text);
  console.error('--------------------');
  console.error(`推定文字数(weighted): ${weight}/280${weight > 280 ? ' ⚠️ 超過（Premium 以外は投稿不可）' : ''}`);

  if (!shouldPost) {
    console.error('dry-run 完了（投稿していません）。投稿するには --post を付けてください');
    return;
  }

  const creds = getCredentialsFromEnv();
  const result = await postTweet(creds, { text });
  console.error(`✅ ツイート投稿完了: https://twitter.com/i/status/${result.tweetId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
