/// <reference types="node" />
/**
 * 指定ツイートへのリプライを時刻順に一覧する。
 *
 *   cd server && npx tsx scripts/list-replies.ts --tweet=<tweetId>
 *
 * v2 recent search（直近7日）を conversation_id で検索する。
 * 認証は server/.env の TWITTER_POST_*（OAuth 1.0a User Context）。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getCredentialsFromEnv, oauth1Get } from '../src/modules/tweet/twitterClient.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

interface Tweet {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: { type: string; id: string }[];
}
interface User { id: string; username: string; name: string }
interface SearchResponse {
  data?: Tweet[];
  includes?: { users?: User[] };
  meta?: { next_token?: string; result_count: number };
}

async function main() {
  const tweetId = argValue('tweet');
  if (!tweetId) throw new Error('--tweet=<tweetId> を指定してください');
  const creds = getCredentialsFromEnv();

  const tweets: Tweet[] = [];
  const users = new Map<string, User>();
  let nextToken: string | undefined;
  do {
    const query: Record<string, string> = {
      query: `conversation_id:${tweetId}`,
      max_results: '100',
      'tweet.fields': 'created_at,author_id,in_reply_to_user_id,referenced_tweets',
      expansions: 'author_id',
      'user.fields': 'username,name',
    };
    if (nextToken) query.next_token = nextToken;
    const res = await oauth1Get(creds, 'https://api.twitter.com/2/tweets/search/recent', query);
    if (!res.ok) throw new Error(`search failed (${res.status}): ${await res.text()}`);
    const json = await res.json() as SearchResponse;
    tweets.push(...(json.data ?? []));
    for (const u of json.includes?.users ?? []) users.set(u.id, u);
    nextToken = json.meta?.next_token;
  } while (nextToken);

  // 検索結果には元ポスト自身も含まれるので除外
  const replies = tweets.filter((t) => t.id !== tweetId);
  replies.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const fmt = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  console.log(`リプライ数: ${replies.length}`);
  for (const t of replies) {
    const u = users.get(t.author_id);
    const direct = t.referenced_tweets?.some((r) => r.type === 'replied_to' && r.id === tweetId) ? '' : ' (孫リプ)';
    console.log(`${fmt.format(new Date(t.created_at))}  @${u?.username ?? t.author_id}  ${u?.name ?? ''}${direct}`);
    console.log(`    ${t.text.replace(/\n/g, ' ')}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
