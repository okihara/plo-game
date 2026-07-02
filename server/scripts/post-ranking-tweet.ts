/// <reference types="node" />
/**
 * RPランキング更新ツイートを画像付きで公式アカウントに投稿する。
 * /ranking-tweet スキルから呼ばれる想定。
 *
 *   # ドライラン（既定。投稿せず内容だけ表示）
 *   cd server && npx tsx scripts/post-ranking-tweet.ts
 *
 *   # 実投稿（--confirm が無いと投稿しない）
 *   cd server && npx tsx scripts/post-ranking-tweet.ts --confirm
 *
 * 文面は /tmp/ranking-tweet.txt（または --text-file=<path>）から読む。
 * コマンドラインに本文・接続URL・トークンを載せないため、ファイル経由で渡す。
 * 画像は /tmp/rp-ranking.png（または --image=<path>）。
 * 認証情報は server/.env の TWITTER_POST_* を使う。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { postTweet, getCredentialsFromEnv } from '../src/modules/tweet/twitterClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

const TEXT_FILE = argValue('text-file') ?? '/tmp/ranking-tweet.txt';
const IMAGE_PATH = argValue('image') ?? '/tmp/rp-ranking.png';
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  if (!existsSync(TEXT_FILE)) {
    throw new Error(`本文ファイルが見つかりません: ${TEXT_FILE}（先に下書きを書き出してください）`);
  }
  const text = readFileSync(TEXT_FILE, 'utf8').trimEnd();
  const hasImage = existsSync(IMAGE_PATH);

  console.log('--- 投稿プレビュー ---');
  console.log(text);
  console.log('---');
  console.log(`文字数: ${[...text].length}`);
  console.log(`画像: ${hasImage ? IMAGE_PATH : '(なし)'}`);

  if (!CONFIRM) {
    console.log('\nドライラン（--confirm が無いため投稿しません）');
    return;
  }

  const creds = getCredentialsFromEnv();
  const image = hasImage ? readFileSync(IMAGE_PATH) : undefined;
  const result = await postTweet(creds, { text, image });
  console.log(`\n✅ 投稿完了 tweetId: ${result.tweetId}`);
  console.log(`URL: https://x.com/i/status/${result.tweetId}`);
}

main().catch((e) => {
  console.error('post failed:', e);
  process.exit(1);
});
