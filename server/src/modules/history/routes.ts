import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';

export async function handHistoryRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ハンド一覧取得（ページネーション付き）
  fastify.get('/', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { limit = 20, offset = 0 } = request.query as {
      limit?: number;
      offset?: number;
    };

    const take = Math.min(Number(limit), 50);
    const skip = Number(offset);

    const [playerHands, total] = await Promise.all([
      prisma.handHistoryPlayer.findMany({
        where: { userId },
        orderBy: { handHistory: { createdAt: 'desc' } },
        take,
        skip,
        include: {
          handHistory: {
            select: {
              id: true,
              handNumber: true,
              blinds: true,
              communityCards: true,
              potSize: true,
              winners: true,
              dealerPosition: true,
              createdAt: true,
              players: {
                select: {
                  userId: true,
                  username: true,
                  seatPosition: true,
                  holeCards: true,
                  finalHand: true,
                  profit: true,
                  user: {
                    select: { avatarUrl: true, useTwitterAvatar: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.handHistoryPlayer.count({ where: { userId } }),
    ]);

    const hands = playerHands.map(ph => ({
      id: ph.handHistory.id,
      handNumber: ph.handHistory.handNumber,
      blinds: ph.handHistory.blinds,
      communityCards: ph.handHistory.communityCards,
      potSize: ph.handHistory.potSize,
      profit: ph.profit,
      finalHand: ph.finalHand,
      holeCards: ph.holeCards,
      isWinner: ph.handHistory.winners.includes(userId),
      dealerPosition: ph.handHistory.dealerPosition,
      createdAt: ph.handHistory.createdAt,
      players: ph.handHistory.players.map(p => ({
        username: p.username || `Seat ${p.seatPosition + 1}`,
        avatarUrl: p.user?.useTwitterAvatar ? (p.user.avatarUrl ?? null) : null,
        seatPosition: p.seatPosition,
        holeCards: p.holeCards,
        finalHand: p.finalHand,
        profit: p.profit,
        isCurrentUser: p.userId === userId,
      })),
    }));

    return { hands, total, limit: take, offset: skip };
  });

  // ハンド詳細取得
  fastify.get('/:handId', async (request: FastifyRequest, reply) => {
    const { userId } = request.user as { userId: string };
    const { handId } = request.params as { handId: string };

    const hand = await prisma.handHistory.findUnique({
      where: { id: handId },
      include: {
        players: {
          select: {
            userId: true,
            username: true,
            seatPosition: true,
            holeCards: true,
            finalHand: true,
            profit: true,
            user: {
              select: { username: true, avatarUrl: true, useTwitterAvatar: true },
            },
          },
        },
      },
    });

    if (!hand) {
      return reply.code(404).send({ error: 'Hand not found' });
    }

    return {
      id: hand.id,
      handNumber: hand.handNumber,
      blinds: hand.blinds,
      communityCards: hand.communityCards,
      potSize: hand.potSize,
      rakeAmount: hand.rakeAmount,
      winners: hand.winners,
      actions: hand.actions,
      dealerPosition: hand.dealerPosition,
      createdAt: hand.createdAt,
      players: hand.players.map(p => ({
        username: p.username || p.user?.username || `Seat ${p.seatPosition + 1}`,
        avatarUrl: p.user?.useTwitterAvatar ? (p.user.avatarUrl ?? null) : null,
        seatPosition: p.seatPosition,
        holeCards: p.holeCards,
        finalHand: p.finalHand,
        profit: p.profit,
        isCurrentUser: p.userId === userId,
      })),
    };
  });
}
