import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';

const DAILY_BONUS = 1000;
const LOGIN_BONUS = 500;

export async function bankrollRoutes(fastify: FastifyInstance) {
  // Auth middleware
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Get balance
  fastify.get('/', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const bankroll = await prisma.bankroll.findUnique({
      where: { userId },
    });

    return { balance: bankroll?.balance ?? 0 };
  });

  // Claim daily bonus
  fastify.post('/daily-bonus', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    // Check if already claimed today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingBonus = await prisma.dailyBonus.findFirst({
      where: {
        odId: userId,
        claimedAt: { gte: today },
      },
    });

    if (existingBonus) {
      return {
        success: false,
        message: 'Daily bonus already claimed',
        nextClaimAt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
      };
    }

    // Give bonus
    const [bankroll] = await prisma.$transaction([
      prisma.bankroll.update({
        where: { userId },
        data: { balance: { increment: DAILY_BONUS } },
      }),
      prisma.dailyBonus.create({
        data: { odId: userId },
      }),
      prisma.transaction.create({
        data: {
          userId,
          type: 'DAILY_BONUS',
          amount: DAILY_BONUS,
        },
      }),
    ]);

    return {
      success: true,
      amount: DAILY_BONUS,
      newBalance: bankroll.balance,
    };
  });

  // Get transaction history
  fastify.get('/history', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const { limit = 20, offset = 0 } = request.query as { limit?: number; offset?: number };

    const transactions = await prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    });

    return { transactions };
  });

  // Refill chips (when balance is low)
  fastify.post('/refill', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const bankroll = await prisma.bankroll.findUnique({
      where: { userId },
    });

    if (!bankroll) {
      return { success: false, message: 'Bankroll not found' };
    }

    // Only allow refill if balance is below 1000
    if (bankroll.balance >= 1000) {
      return {
        success: false,
        message: 'Balance too high for refill. Must be below 1000 chips.',
        currentBalance: bankroll.balance,
      };
    }

    const refillAmount = 5000 - bankroll.balance;

    const updated = await prisma.bankroll.update({
      where: { userId },
      data: { balance: 5000 },
    });

    await prisma.transaction.create({
      data: {
        userId,
        type: 'LOGIN_BONUS',
        amount: refillAmount,
      },
    });

    return {
      success: true,
      amount: refillAmount,
      newBalance: updated.balance,
    };
  });
}
