import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { maskName, MASKED_PLAYER_NAME, generateShareToken, verifyShareToken } from '../../shared/utils.js';
import { env } from '../../config/env.js';
import { fetchTournamentHandsForUser } from './tournamentHandsForUser.js';

// 公開用ハンド詳細API（認証不要、シェアリンク用）
export async function publicHandHistoryRoutes(fastify: FastifyInstance) {
  fastify.get('/:handId', async (request: FastifyRequest, reply) => {
    const { handId } = request.params as { handId: string };
    const token = (request.query as Record<string, string>).t || '';
    const revealedSeat = verifyShareToken(handId, token, env.JWT_SECRET);

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
            startChips: true,
            profit: true,
            user: {
              select: { username: true, displayName: true, avatarUrl: true, useTwitterAvatar: true, nameMasked: true },
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
      players: hand.players.map(p => {
        const rawName = p.username || p.user?.username || `Seat ${p.seatPosition + 1}`;
        const isRevealed = p.seatPosition === revealedSeat;
        const username = isRevealed
          ? (p.user?.displayName || rawName)
          : MASKED_PLAYER_NAME;
        return {
          username,
          avatarUrl: isRevealed ? (p.user?.avatarUrl ?? null) : null,
          seatPosition: p.seatPosition,
          holeCards: p.holeCards,
          finalHand: p.finalHand,
          startChips: p.startChips,
          profit: p.profit,
          isCurrentUser: false,
        };
      }),
    };
  });
}

export async function handHistoryRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // ユーザーが参加したトーナメント一覧（プルダウン用）
  fastify.get('/tournaments', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    // ユーザーのハンド履歴から重複なしの tournamentId を取得
    const rows = await prisma.handHistory.findMany({
      where: {
        NOT: { tournamentId: null },
        players: { some: { userId } },
      },
      distinct: ['tournamentId'],
      select: { tournamentId: true },
      orderBy: { createdAt: 'desc' },
    });

    const tournamentIds = rows
      .map(r => r.tournamentId)
      .filter((id): id is string => id !== null);

    if (tournamentIds.length === 0) return { tournaments: [] };

    // Tournament テーブルから名前等を取得
    const tournaments = await prisma.tournament.findMany({
      where: { id: { in: tournamentIds } },
      select: { id: true, name: true, startedAt: true, completedAt: true },
      orderBy: { createdAt: 'desc' },
    });

    return { tournaments };
  });

  // トーナメント全ハンド履歴エクスポート
  fastify.get('/tournaments/:tournamentId/export', async (request: FastifyRequest, reply) => {
    const { userId } = request.user as { userId: string };
    const { tournamentId } = request.params as { tournamentId: string };

    const formatted = await fetchTournamentHandsForUser(prisma, tournamentId, userId);

    if (formatted.length === 0) {
      return reply.code(404).send({ error: 'No hands found' });
    }

    return { hands: formatted };
  });

  // ハンド一覧取得（ページネーション付き）
  fastify.get('/', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { limit = 20, offset = 0, gameType, tournamentId } = request.query as {
      limit?: number;
      offset?: number;
      gameType?: 'cash' | 'tournament';
      tournamentId?: string;
    };

    const take = Math.min(Number(limit), 50);
    const skip = Number(offset);

    const tournamentFilter = tournamentId
      ? { tournamentId }
      : gameType === 'cash'
        ? { tournamentId: null }
        : gameType === 'tournament'
          ? { NOT: { tournamentId: null } }
          : {};

    const [playerHands, total] = await Promise.all([
      prisma.handHistoryPlayer.findMany({
        where: { userId, handHistory: tournamentFilter },
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
                  startChips: true,
                  profit: true,
                  user: {
                    select: { displayName: true, avatarUrl: true, useTwitterAvatar: true, nameMasked: true },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.handHistoryPlayer.count({ where: { userId, handHistory: tournamentFilter } }),
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
      players: ph.handHistory.players.map(p => {
        const rawName = p.username || `Seat ${p.seatPosition + 1}`;
        return {
        userId: p.userId,
        username: p.user?.displayName ? p.user.displayName : ((p.userId !== userId && p.user?.nameMasked) ? maskName(rawName) : rawName),
        avatarUrl: p.user?.avatarUrl ?? null,
        seatPosition: p.seatPosition,
        holeCards: p.holeCards,
        finalHand: p.finalHand,
        startChips: p.startChips,
        profit: p.profit,
        isCurrentUser: p.userId === userId,
      };
      }),
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
            startChips: true,
            profit: true,
            user: {
              select: { username: true, displayName: true, avatarUrl: true, useTwitterAvatar: true, nameMasked: true },
            },
          },
        },
      },
    });

    if (!hand) {
      return reply.code(404).send({ error: 'Hand not found' });
    }

    // シェアした人のシート番号を特定してトークン生成
    const myPlayer = hand.players.find(p => p.userId === userId);
    const shareToken = myPlayer != null
      ? generateShareToken(hand.id, myPlayer.seatPosition, env.JWT_SECRET)
      : undefined;

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
      shareToken,
      players: hand.players.map(p => {
        const rawName = p.username || p.user?.username || `Seat ${p.seatPosition + 1}`;
        return {
          userId: p.userId,
          username: p.user?.displayName ? p.user.displayName : ((p.userId !== userId && p.user?.nameMasked) ? maskName(rawName) : rawName),
          avatarUrl: p.user?.avatarUrl ?? null,
          seatPosition: p.seatPosition,
          holeCards: p.holeCards,
          finalHand: p.finalHand,
          startChips: p.startChips,
          profit: p.profit,
          isCurrentUser: p.userId === userId,
        };
      }),
    };
  });
}
