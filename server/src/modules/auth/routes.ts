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
  // Google OAuth
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    await fastify.register(oauth2, {
      name: 'googleOAuth2',
      scope: ['profile', 'email'],
      credentials: {
        client: {
          id: env.GOOGLE_CLIENT_ID,
          secret: env.GOOGLE_CLIENT_SECRET,
        },
      },
      startRedirectPath: '/google',
      callbackUri: `${env.CLIENT_URL}/api/auth/google/callback`,
      discovery: {
        issuer: 'https://accounts.google.com',
      },
    });

    fastify.get('/google/callback', async function (request, reply) {
      try {
        const { token } = await (this as any).googleOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

        // Get user info from Google
        const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const googleUser = await response.json() as OAuthUserInfo;

        const user = await findOrCreateUser({
          provider: 'google',
          providerId: googleUser.id,
          email: googleUser.email,
          username: googleUser.name || googleUser.email.split('@')[0],
          avatarUrl: googleUser.picture,
        });

        const jwt = fastify.jwt.sign({ userId: user.id }, { expiresIn: '7d' });

        reply
          .setCookie('token', jwt, {
            path: '/',
            httpOnly: true,
            secure: env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 7, // 7 days
          })
          .redirect(`${env.CLIENT_URL}/lobby`);
      } catch (err) {
        console.error('Google OAuth error:', err);
        reply.redirect(`${env.CLIENT_URL}/login?error=oauth_failed`);
      }
    });
  }

  // Discord OAuth
  if (env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) {
    await fastify.register(oauth2, {
      name: 'discordOAuth2',
      scope: ['identify', 'email'],
      credentials: {
        client: {
          id: env.DISCORD_CLIENT_ID,
          secret: env.DISCORD_CLIENT_SECRET,
        },
      },
      startRedirectPath: '/discord',
      callbackUri: `${env.CLIENT_URL}/api/auth/discord/callback`,
      tokenEndpoint: 'https://discord.com/api/oauth2/token',
      authorizationEndpoint: 'https://discord.com/api/oauth2/authorize',
    });

    fastify.get('/discord/callback', async function (request, reply) {
      try {
        const { token } = await (this as any).discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request);

        // Get user info from Discord
        const response = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${token.access_token}` },
        });
        const discordUser = await response.json() as any;

        const user = await findOrCreateUser({
          provider: 'discord',
          providerId: discordUser.id,
          email: discordUser.email,
          username: discordUser.username,
          avatarUrl: discordUser.avatar
            ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
            : null,
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
          .redirect(`${env.CLIENT_URL}/lobby`);
      } catch (err) {
        console.error('Discord OAuth error:', err);
        reply.redirect(`${env.CLIENT_URL}/login?error=oauth_failed`);
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
    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  return user;
}
