/// <reference types="node" />
/**
 * ツイートを（任意で画像付きで）公式アカウントに投稿する汎用スクリプト。
 * /ranking-tweet, /tournament-tweet 等のスキルから呼ばれる想定。
 *
 *   # ドライラン（既定。投稿せず内容だけ表示）
 *   cd server && npx tsx scripts/post-tweet.ts --text-file=/tmp/xxx.txt --image=/tmp/xxx.png
 *
 *   # 実投稿（--confirm が無いと投稿しない）
 *   cd server && npx tsx scripts/post-tweet.ts --text-file=/tmp/xxx.txt --image=/tmp/xxx.png --confirm
 *
 * 文面は --text-file=<path> のファイルから読む。
 * コマンドラインに本文・接続URL・トークンを載せないため、必ずファイル経由で渡す。
 * 画像は --image=<path>（省略時はテキストのみ投稿）。
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

const TEXT_FILE = argValue('text-file');
const IMAGE_PATH = argValue('image');
const CONFIRM = process.argv.includes('--confirm');

async function main() {
  if (!TEXT_FILE) {
    throw new Error('--text-file=<path> で本文ファイルを指定してください');
  }
  if (!existsSync(TEXT_FILE)) {
    throw new Error(`本文ファイルが見つかりません: ${TEXT_FILE}（先に下書きを書き出してください）`);
  }
  if (IMAGE_PATH && !existsSync(IMAGE_PATH)) {
    throw new Error(`画像ファイルが見つかりません: ${IMAGE_PATH}`);
  }
  const text = readFileSync(TEXT_FILE, 'utf8').trimEnd();
  const hasImage = !!IMAGE_PATH;

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
