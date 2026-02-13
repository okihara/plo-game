import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { computeStats, StoredAction } from './computeStats.js';

const CACHE_TTL_MS = 60_000; // 60秒
const MAX_HANDS = 1000;

const statsCache = new Map<string, { data: unknown; expiresAt: number }>();

export async function statsRoutes(fastify: FastifyInstance) {
  fastify.get('/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };

    if (userId.startsWith('guest_') || userId.startsWith('bot_')) {
      return reply.code(404).send({ error: 'Stats not available' });
    }

    // キャッシュチェック
    const cached = statsCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const playerHands = await prisma.handHistoryPlayer.findMany({
      where: { userId },
      orderBy: { handHistory: { createdAt: 'desc' } },
      take: MAX_HANDS,
      include: {
        handHistory: {
          include: {
            players: {
              select: { userId: true, seatPosition: true, profit: true, finalHand: true },
            },
          },
        },
      },
    });

    if (playerHands.length === 0) {
      const result = { stats: null, handsAnalyzed: 0 };
      statsCache.set(userId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

    const handHistories = playerHands.map(ph => ({
      id: ph.handHistory.id,
      actions: ph.handHistory.actions as unknown as StoredAction[],
      dealerPosition: ph.handHistory.dealerPosition,
      winners: ph.handHistory.winners,
      blinds: ph.handHistory.blinds,
      communityCards: ph.handHistory.communityCards,
      players: ph.handHistory.players,
    }));

    const stats = computeStats(handHistories, userId);

    const result = { stats, handsAnalyzed: playerHands.length };
    statsCache.set(userId, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  });
}
