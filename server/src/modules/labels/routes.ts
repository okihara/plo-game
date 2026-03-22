import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';

const VALID_COLORS = ['red', 'blue', 'green', 'yellow', 'gray'] as const;

export async function labelRoutes(fastify: FastifyInstance) {
  // 認証チェック用のpreHandler
  fastify.addHook('preHandler', async (request) => {
    await request.jwtVerify();
  });

  // 自分が付けた全ラベルを取得
  fastify.get('/', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const labels = await prisma.playerLabel.findMany({
      where: { ownerId: userId },
      select: {
        targetUserId: true,
        color: true,
        note: true,
      },
    });

    return { labels };
  });

  // ラベルを設定/更新
  fastify.put('/:targetUserId', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { targetUserId } = request.params as { targetUserId: string };
    const { color, note } = request.body as { color: string; note?: string };

    if (targetUserId === userId) {
      return { error: '自分自身にラベルは付けられません' };
    }

    if (!VALID_COLORS.includes(color as typeof VALID_COLORS[number])) {
      return { error: '無効な色です' };
    }

    const label = await prisma.playerLabel.upsert({
      where: {
        ownerId_targetUserId: { ownerId: userId, targetUserId },
      },
      create: {
        ownerId: userId,
        targetUserId,
        color,
        note: note ?? '',
      },
      update: {
        color,
        note: note ?? '',
      },
      select: {
        targetUserId: true,
        color: true,
        note: true,
      },
    });

    return { label };
  });

  // ラベルを削除
  fastify.delete('/:targetUserId', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { targetUserId } = request.params as { targetUserId: string };

    await prisma.playerLabel.deleteMany({
      where: { ownerId: userId, targetUserId },
    });

    return { ok: true };
  });
}
