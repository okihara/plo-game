import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { env, allowedOrigins } from '../../config/env.js';

/**
 * `CLIENT_URL` と `CLIENT_URL_ALIASES` の双方で OAuth が成立するよう、
 * リクエストが届いたオリジンを基にコールバック URL と成功・失敗時のリダイレクト先を
 * 組み立てる。許可リストにないホストは `CLIENT_URL` にフォールバックする。
 */
export function originFromRequest(request: FastifyRequest): { serverBase: string; clientBase: string } {
  if (env.NODE_ENV !== 'production') {
    return {
      serverBase: `http://localhost:${env.PORT}`,
      clientBase: env.CLIENT_URL,
    };
  }
  const candidate = `${request.protocol}://${request.hostname}`;
  if (allowedOrigins.includes(candidate)) {
    return { serverBase: candidate, clientBase: candidate };
  }
  return { serverBase: env.CLIENT_URL, clientBase: env.CLIENT_URL };
}

/** ログイン成功時のセッション JWT を発行して httpOnly Cookie にセットする */
export function setSessionCookie(fastify: FastifyInstance, reply: FastifyReply, userId: string): void {
  const jwt = fastify.jwt.sign({ userId }, { expiresIn: '7d' });
  reply.setCookie('token', jwt, {
    path: '/',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function findOrCreateUser(data: {
  provider: string;
  providerId: string;
  email: string;
  username: string;
  avatarUrl: string | null;
  twitterAvatarUrl?: string | null;
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

    // email は @unique。別アカウントが同じ email を既に使っている場合は
    // プロバイダ固有のプレースホルダーにフォールバックする
    let email = data.email;
    if (await prisma.user.findUnique({ where: { email } })) {
      email = `${data.providerId}@${data.provider}.placeholder`;
    }

    user = await prisma.user.create({
      data: {
        email,
        username,
        avatarUrl: data.avatarUrl,
        twitterAvatarUrl: data.twitterAvatarUrl ?? null,
        provider: data.provider,
        providerId: data.providerId,
        lastLoginAt: new Date(),
        bankroll: {
          create: { balance: 10000 },
        },
      },
    });
  } else {
    // twitterAvatarUrl は毎ログイン時に更新、avatarUrl は useTwitterAvatar=true の場合のみ更新
    const updateData: Record<string, unknown> = {
      lastLoginAt: new Date(),
      twitterAvatarUrl: data.twitterAvatarUrl ?? user.twitterAvatarUrl,
    };
    if (user.useTwitterAvatar) {
      updateData.avatarUrl = data.avatarUrl;
    }
    user = await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });
  }

  return user;
}
