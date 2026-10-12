/**
 * 定型ツイート共通の末尾（ハッシュタグ＋アプリURL＋Discord招待）。
 */
import { APP_URL, DISCORD_INVITE_URL } from '@plo/shared';

export const TWEET_HASHTAG = '#BabyPLO';

export const TWEET_FOOTER_LINES: readonly string[] = [TWEET_HASHTAG, APP_URL, DISCORD_INVITE_URL];
