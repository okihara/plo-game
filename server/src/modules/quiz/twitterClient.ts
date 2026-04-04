/**
 * Twitter API v2 投稿クライアント。
 * OAuth 1.0a User Context で公式アカウントからツイートを投稿する。
 * auth/routes.ts の oauth1Fetch パターンを踏襲。
 */
import crypto from 'crypto';

interface TwitterCredentials {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function signOAuth1(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}=${percentEncode(v)}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    percentEncode(url),
    percentEncode(sortedParams),
  ].join('&');

  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(oauthParams: Record<string, string>): string {
  const parts = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');
  return `OAuth ${parts}`;
}

async function oauth1Request(
  creds: TwitterCredentials,
  method: string,
  url: string,
  body?: unknown,
  contentType?: string,
): Promise<Response> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };

  oauthParams.oauth_signature = signOAuth1(
    method, url, oauthParams, creds.apiKeySecret, creds.accessTokenSecret,
  );

  const headers: Record<string, string> = {
    Authorization: buildAuthHeader(oauthParams),
  };
  if (contentType) headers['Content-Type'] = contentType;

  return fetch(url, {
    method,
    headers,
    body: body !== undefined
      ? (typeof body === 'string' ? body : JSON.stringify(body))
      : undefined,
  });
}

/** 画像をアップロードし media_id を返す (v1.1 media/upload) */
async function uploadMedia(creds: TwitterCredentials, imageBuffer: Buffer): Promise<string> {
  const boundary = `----FormBoundary${crypto.randomBytes(8).toString('hex')}`;
  const CRLF = '\r\n';

  const bodyParts = [
    `--${boundary}${CRLF}`,
    `Content-Disposition: form-data; name="media_data"${CRLF}${CRLF}`,
    imageBuffer.toString('base64'),
    `${CRLF}--${boundary}--${CRLF}`,
  ];
  const bodyStr = bodyParts.join('');

  // media/upload は OAuth 1.0a + multipart
  const url = 'https://upload.twitter.com/1.1/media/upload.json';
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  oauthParams.oauth_signature = signOAuth1(
    'POST', url, oauthParams, creds.apiKeySecret, creds.accessTokenSecret,
  );

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(oauthParams),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: bodyStr,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Media upload failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { media_id_string: string };
  return data.media_id_string;
}

interface PostTweetOptions {
  text: string;
  /** 投票の選択肢（2〜4つ） */
  pollOptions?: string[];
  /** 投票期間（分）。デフォルト1440（24時間） */
  pollDurationMinutes?: number;
  /** 添付画像 */
  image?: Buffer;
  /** リプライ先ツイートID */
  replyToTweetId?: string;
}

interface TweetResult {
  tweetId: string;
}

/** ツイートを投稿する (Twitter API v2) */
export async function postTweet(
  creds: TwitterCredentials,
  options: PostTweetOptions,
): Promise<TweetResult> {
  let mediaId: string | undefined;
  if (options.image) {
    mediaId = await uploadMedia(creds, options.image);
  }

  const payload: Record<string, unknown> = {
    text: options.text,
  };

  if (options.pollOptions && options.pollOptions.length >= 2) {
    payload.poll = {
      options: options.pollOptions,
      duration_minutes: options.pollDurationMinutes ?? 1440,
    };
  }

  if (mediaId) {
    payload.media = { media_ids: [mediaId] };
  }

  if (options.replyToTweetId) {
    payload.reply = { in_reply_to_tweet_id: options.replyToTweetId };
  }

  const res = await oauth1Request(
    creds,
    'POST',
    'https://api.twitter.com/2/tweets',
    payload,
    'application/json',
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tweet post failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { data: { id: string } };
  return { tweetId: data.data.id };
}

/** 環境変数からクレデンシャルを取得 */
export function getCredentialsFromEnv(): TwitterCredentials {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiKeySecret = process.env.TWITTER_API_KEY_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessTokenSecret = process.env.TWITTER_ACCESS_TOKEN_SECRET;

  if (!apiKey || !apiKeySecret || !accessToken || !accessTokenSecret) {
    throw new Error(
      'Missing Twitter credentials. Set TWITTER_API_KEY, TWITTER_API_KEY_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET',
    );
  }

  return { apiKey, apiKeySecret, accessToken, accessTokenSecret };
}
