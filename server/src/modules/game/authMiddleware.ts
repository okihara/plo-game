import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';

export interface AuthenticatedSocket extends Socket {
  odId?: string;
  odIsBot?: boolean;
}

// Bot用ユーザーをDBにfind or create
async function findOrCreateBotUser(botName: string, botAvatar: string | null) {
  const providerId = botName;
  let user = await prisma.user.findUnique({
    where: { provider_providerId: { provider: 'bot', providerId } },
  });

  if (!user) {
    let username = botName;
    let suffix = 1;
    while (await prisma.user.findUnique({ where: { username } })) {
      username = `${botName}${suffix}`;
      suffix++;
    }

    user = await prisma.user.create({
      data: {
        email: `${botName.toLowerCase().replace(/[^a-z0-9]/g, '_')}@bot.local`,
        username,
        avatarUrl: botAvatar,
        provider: 'bot',
        providerId,
        bankroll: { create: { balance: 10000 } },
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  return user;
}

export function setupAuthMiddleware(io: Server, fastify: FastifyInstance): void {
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Check if this is a bot connection
      const isBot = socket.handshake.auth.isBot === true;
      if (isBot) {
        const botName = socket.handshake.auth.botName || 'Bot';
        const botAvatar = socket.handshake.auth.botAvatar || null;

        const user = await findOrCreateBotUser(botName, botAvatar);

        socket.odId = user.id;
        socket.odIsBot = true;

        console.log(`Bot connected: ${user.id} (${user.username})`);
        return next();
      }

      const token = socket.handshake.auth.token ||
        socket.handshake.headers.cookie?.split('token=')[1]?.split(';')[0];

      if (!token) {
        return next(new Error('認証が必要です'));
      }

      const decoded = fastify.jwt.verify<{ userId: string }>(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { bankroll: true },
      });

      if (!user) {
        return next(new Error('ユーザーが見つかりません'));
      }

      socket.odId = user.id;
      socket.odIsBot = false;
      return next();
    } catch (err) {
      console.warn('Socket auth failed:', err);
      return next(new Error('認証に失敗しました'));
    }
  });
}
