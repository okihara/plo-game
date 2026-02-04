import { FastifyInstance, FastifyRequest } from 'fastify';
import oauth2 from '@fastify/oauth2';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';

interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export async function authRoutes(fastify: FastifyInstance) {
  // Twitter OAuth
  if (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET) {
    const serverBaseUrl = env.NODE_ENV === 'production'
      ? env.CLIENT_URL
      : `http://localhost:${env.PORT}`;

    await fastify.register(oauth2, {
      name: 'twitterOAuth2',
      scope: ['users.read', 'offline.access'],
      credentials: {
        client: {
          id: env.TWITTER_CLIENT_ID,
          secret: env.TWITTER_CLIENT_SECRET,
        },
        auth: {
          authorizeHost: 'https://twitter.com',
          authorizePath: '/i/oauth2/authorize',
          tokenHost: 'https://api.x.com',
          tokenPath: '/2/oauth2/token',
        },
      },
      startRedirectPath: '/twitter',
      callbackUri: `${serverBaseUrl}/api/auth/twitter/callback`,
      pkce: 'S256', // Twitter OAuth 2.0 requires PKCE
    });

    fastify.get('/twitter/callback', async function (request, reply) {
      try {
        const { token } = await (this as any).twitterOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

        // Get user info from Twitter API v2
        const response = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url', {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const data = await response.json() as any;
        const twitterUser = data.data;

        // プロフィール画像を高解像度版に変換 (_normal -> _400x400)
        const avatarUrl = twitterUser.profile_image_url
          ? twitterUser.profile_image_url.replace('_normal', '_400x400')
          : null;

        const user = await findOrCreateUser({
          provider: 'twitter',
          providerId: twitterUser.id,
          email: `${twitterUser.username}@twitter.placeholder`,
          username: twitterUser.username,
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
        console.error('Twitter OAuth error:', err);

        // Log detailed error for debugging
        if (err instanceof Error) {
          console.error('Error details:', {
            message: err.message,
            stack: err.stack,
            name: err.name,
          });
        }

        // Check if it's a database error
        if (err && typeof err === 'object' && 'code' in err) {
          if ((err as any).code === 'P1001' || (err as any).code === 'ECONNREFUSED') {
            console.error('❌ Database connection error. Make sure PostgreSQL is running: docker-compose up -d');
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
        reply.code(401).send({ error: 'Unauthorized' });
      }
    },
  }, async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { bankroll: true },
    });

    if (!user) {
      return { error: 'User not found' };
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      avatarUrl: user.avatarUrl,
      balance: user.bankroll?.balance ?? 0,
    };
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
        bankroll: {
          create: { balance: 10000 }, // Starting balance
        },
      },
    });
  } else {
    // Update last login and avatar URL (in case it changed)
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
