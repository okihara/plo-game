import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';

const DAILY_BONUS = 1000;
const LOGIN_BONUS_TARGET = 600;
const DEBUG_ADD_AMOUNT = 10000;

// バイイン引き落とし（着席直前に呼ばれる）
export async function deductBuyIn(odId: string, amount: number): Promise<boolean> {
  try {
    const bankroll = await prisma.bankroll.findUnique({ where: { userId: odId } });
    if (!bankroll || bankroll.balance < amount) return false;

    await prisma.bankroll.update({
      where: { userId: odId },
      data: { balance: { decrement: amount } },
    });
    await prisma.transaction.create({
      data: { userId: odId, type: 'BUY_IN', amount: -amount },
    });
    return true;
  } catch (e) {
    console.error('deductBuyIn failed:', odId, amount, e);
    return false;
  }
}

// キャッシュアウト（テーブル離脱時・バイイン返金時）
export async function cashOutPlayer(odId: string, chips: number, tableId?: string): Promise<void> {
  if (chips <= 0) return;
  try {
    await prisma.bankroll.update({
      where: { userId: odId },
      data: { balance: { increment: chips } },
    });
    await prisma.transaction.create({
      data: { userId: odId, type: 'CASH_OUT', amount: chips, tableId },
    });
  } catch (e) {
    console.error('Cash-out failed:', odId, chips, e);
  }
}

/** 直近の JST 3:00 (= UTC 18:00) の境界を返す */
function getJst3amBoundary(): Date {
  const now = new Date();
  const today18utc = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 18, 0, 0,
  ));
  return now < today18utc
    ? new Date(today18utc.getTime() - 24 * 60 * 60 * 1000)
    : today18utc;
}

/** ログインボーナスが取得可能かチェック */
export async function isLoginBonusAvailable(userId: string): Promise<boolean> {
  const bankroll = await prisma.bankroll.findUnique({ where: { userId } });
  if (!bankroll || bankroll.balance >= LOGIN_BONUS_TARGET) return false;

  const boundary = getJst3amBoundary();
  const existing = await prisma.transaction.findFirst({
    where: { userId, type: 'LOGIN_BONUS', createdAt: { gte: boundary } },
  });
  return !existing;
}

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

  // Login bonus: top up to 600 (once per day, resets at JST 7:00)
  fastify.post('/login-bonus', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const available = await isLoginBonusAvailable(userId);
    if (!available) {
      return { success: false, message: 'Login bonus not available' };
    }

    const bankroll = await prisma.bankroll.findUnique({ where: { userId } });
    const currentBalance = bankroll?.balance ?? 0;
    const topUpAmount = LOGIN_BONUS_TARGET - currentBalance;

    const updated = await prisma.bankroll.update({
      where: { userId },
      data: { balance: LOGIN_BONUS_TARGET },
    });

    await prisma.transaction.create({
      data: { userId, type: 'LOGIN_BONUS', amount: topUpAmount },
    });

    return {
      success: true,
      amount: topUpAmount,
      newBalance: updated.balance,
    };
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

  // Debug: add chips (development only)
  if (process.env.NODE_ENV !== 'production') {
    fastify.post('/debug-add', async (request: FastifyRequest) => {
      const { userId } = request.user as { userId: string };

      const bankroll = await prisma.bankroll.update({
        where: { userId },
        data: { balance: { increment: DEBUG_ADD_AMOUNT } },
      });

      await prisma.transaction.create({
        data: {
          userId,
          type: 'LOGIN_BONUS',
          amount: DEBUG_ADD_AMOUNT,
        },
      });

      return {
        success: true,
        amount: DEBUG_ADD_AMOUNT,
        newBalance: bankroll.balance,
      };
    });

    fastify.post('/debug-set', async (request: FastifyRequest) => {
      const { userId } = request.user as { userId: string };
      const { amount } = request.body as { amount: number };

      const bankroll = await prisma.bankroll.update({
        where: { userId },
        data: { balance: amount },
      });

      return {
        success: true,
        newBalance: bankroll.balance,
      };
    });
  }
}
