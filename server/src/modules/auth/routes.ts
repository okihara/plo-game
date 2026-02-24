import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { isLoginBonusAvailable } from './bankroll.js';

// --- OAuth 1.0a helpers ---

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
  tokenSecret = '',
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

async function oauth1Fetch(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  opts: {
    token?: string;
    tokenSecret?: string;
    extra?: Record<string, string>;   // additional oauth_ params (e.g. oauth_callback, oauth_verifier)
    query?: Record<string, string>;   // query string params (included in signature)
  } = {},
): Promise<Response> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...(opts.extra || {}),
  };
  if (opts.token) oauthParams.oauth_token = opts.token;

  // Signature covers oauth params + query params
  const allParams = { ...oauthParams, ...(opts.query || {}) };
  oauthParams.oauth_signature = signOAuth1(method, url, allParams, consumerSecret, opts.tokenSecret || '');

  let requestUrl = url;
  if (opts.query && Object.keys(opts.query).length > 0) {
    requestUrl += '?' + new URLSearchParams(opts.query).toString();
  }

  return fetch(requestUrl, {
    method,
    headers: { Authorization: buildAuthHeader(oauthParams) },
  });
}

// Temporary store for request token secrets (expires after 10 min)
const pendingTokens = new Map<string, { secret: string; expires: number }>();

function cleanupPendingTokens() {
  const now = Date.now();
  for (const [k, v] of pendingTokens) {
    if (v.expires < now) pendingTokens.delete(k);
  }
}

// --- Routes ---

export async function authRoutes(fastify: FastifyInstance) {
  // Twitter OAuth 1.0a
  if (env.TWITTER_API_KEY && env.TWITTER_API_KEY_SECRET) {
    const apiKey = env.TWITTER_API_KEY;
    const apiKeySecret = env.TWITTER_API_KEY_SECRET;
    const serverBaseUrl = env.NODE_ENV === 'production'
      ? env.CLIENT_URL
      : `http://localhost:${env.PORT}`;
    const callbackUrl = `${serverBaseUrl}/api/auth/twitter/callback`;

    // Step 1: Start OAuth — get request token, redirect to Twitter
    fastify.get('/twitter', async (request, reply) => {
      try {
        cleanupPendingTokens();

        const res = await oauth1Fetch('POST', 'https://api.twitter.com/oauth/request_token', apiKey, apiKeySecret, {
          extra: { oauth_callback: callbackUrl },
        });

        if (!res.ok) {
          const body = await res.text();
          fastify.log.error({ status: res.status, body }, 'Failed to get request token');
          return reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
        }

        const text = await res.text();
        const params = new URLSearchParams(text);
        const oauthToken = params.get('oauth_token')!;
        const oauthTokenSecret = params.get('oauth_token_secret')!;

        // Store secret for callback
        pendingTokens.set(oauthToken, {
          secret: oauthTokenSecret,
          expires: Date.now() + 10 * 60 * 1000,
        });

        reply.redirect(`https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}`);
      } catch (err) {
        fastify.log.error(err, 'Twitter OAuth start error');
        reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
      }
    });

    // Step 2: Callback — exchange for access token, get user info
    fastify.get('/twitter/callback', async (request, reply) => {
      try {
        const { oauth_token, oauth_verifier } = request.query as {
          oauth_token?: string;
          oauth_verifier?: string;
        };

        if (!oauth_token || !oauth_verifier) {
          fastify.log.error('Missing oauth_token or oauth_verifier in callback');
          return reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
        }

        // Retrieve stored request token secret
        const pending = pendingTokens.get(oauth_token);
        if (!pending) {
          fastify.log.error('Request token not found or expired');
          return reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
        }
        pendingTokens.delete(oauth_token);

        // Exchange for access token
        const tokenRes = await oauth1Fetch('POST', 'https://api.twitter.com/oauth/access_token', apiKey, apiKeySecret, {
          token: oauth_token,
          tokenSecret: pending.secret,
          extra: { oauth_verifier },
        });

        if (!tokenRes.ok) {
          const body = await tokenRes.text();
          fastify.log.error({ status: tokenRes.status, body }, 'Failed to get access token');
          return reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
        }

        const tokenText = await tokenRes.text();
        const tokenParams = new URLSearchParams(tokenText);
        const accessToken = tokenParams.get('oauth_token')!;
        const accessTokenSecret = tokenParams.get('oauth_token_secret')!;
        const twitterId = tokenParams.get('user_id')!;
        const twitterUsername = tokenParams.get('screen_name')!;

        // Get profile image via verify_credentials
        let avatarUrl: string | null = null;
        try {
          const profileRes = await oauth1Fetch(
            'GET',
            'https://api.twitter.com/1.1/account/verify_credentials.json',
            apiKey, apiKeySecret,
            {
              token: accessToken,
              tokenSecret: accessTokenSecret,
              query: { include_entities: 'false', skip_status: 'true' },
            },
          );

          if (profileRes.ok) {
            const profile = await profileRes.json() as any;
            if (profile.profile_image_url_https) {
              avatarUrl = profile.profile_image_url_https.replace('_normal', '_400x400');
            }
          } else {
            // Non-critical — continue without avatar
            fastify.log.warn({ status: profileRes.status }, 'Failed to get Twitter profile image');
          }
        } catch (e) {
          console.warn('Failed to fetch Twitter profile image:', e);
        }

        const user = await findOrCreateUser({
          provider: 'twitter',
          providerId: twitterId,
          email: `${twitterUsername}@twitter.placeholder`,
          username: twitterUsername,
          avatarUrl,
        });

        const jwt = fastify.jwt.sign({ userId: user.id }, { expiresIn: '7d' });

        reply
          .setCookie('token', jwt, {
            path: '/',
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7,
          })
          .redirect(`${env.CLIENT_URL}/`);
      } catch (err) {
        fastify.log.error(err, 'Twitter OAuth callback error');

        if (err && typeof err === 'object' && 'code' in err) {
          if ((err as any).code === 'P1001' || (err as any).code === 'ECONNREFUSED') {
            fastify.log.error('Database connection error. Make sure PostgreSQL is running: docker-compose up -d');
          }
        }

        reply.redirect(`${env.CLIENT_URL}/?error=oauth_failed`);
      }
    });
  }

  // Get current user
  fastify.get('/me', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
      include: { bankroll: true },
    }).catch(() => null);

    if (!user) {
      return { error: 'User not found' };
    }

    const loginBonusAvailable = await isLoginBonusAvailable(user.id);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl,
      balance: user.bankroll?.balance ?? 0,
      loginBonusAvailable,
      nameMasked: user.nameMasked,
      useTwitterAvatar: user.useTwitterAvatar,
    };
  });

  // Toggle name masking
  fastify.patch('/name-mask', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { nameMasked } = request.body as { nameMasked: boolean };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { nameMasked },
    });

    return { nameMasked: user.nameMasked };
  });

  // Toggle Twitter avatar usage
  fastify.patch('/twitter-avatar', {
    preHandler: async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch (err) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { useTwitterAvatar } = request.body as { useTwitterAvatar: boolean };

    const user = await prisma.user.update({
      where: { id: userId },
      data: { useTwitterAvatar },
    });

    return { useTwitterAvatar: user.useTwitterAvatar };
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    reply
      .clearCookie('token', { path: '/' })
      .send({ success: true });
  });

  // Dev: Quick login for testing (only in development)
  if (env.NODE_ENV === 'development') {
    fastify.post('/dev-login', async (request, reply) => {
      const { username } = request.body as { username: string };

      let user = await prisma.user.findUnique({
        where: { username },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: `${username}@dev.local`,
            username,
            provider: 'dev',
            providerId: username,
            bankroll: {
              create: { balance: 10000 },
            },
          },
        });
      }

      const jwt = fastify.jwt.sign({ userId: user.id }, { expiresIn: '7d' });

      reply
        .setCookie('token', jwt, {
          path: '/',
          httpOnly: true,
          secure: false,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
        })
        .send({ success: true, user: { id: user.id, username: user.username } });
    });
  }
}

async function findOrCreateUser(data: {
  provider: string;
  providerId: string;
  email: string;
  username: string;
  avatarUrl: string | null;
}) {
  let user = await prisma.user.findUnique({
    where: {
      provider_providerId: {
        provider: data.provider,
        providerId: data.providerId,
      },
    },
  });

  if (!user) {
    // Check if username exists
    let username = data.username;
    let suffix = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${data.username}${suffix}`;
      suffix++;
    }

    user = await prisma.user.create({
      data: {
        email: data.email,
        username,
        avatarUrl: data.avatarUrl,
        provider: data.provider,
        providerId: data.providerId,
        lastLoginAt: new Date(),
        bankroll: {
          create: { balance: 10000 },
        },
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        avatarUrl: data.avatarUrl,
      },
    });
  }

  return user;
}
