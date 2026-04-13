import type { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

/** この時間を超えた PENDING は失敗扱いにし、再生成を許可する */
export const PENDING_EVALUATION_STALE_MS = 15 * 60 * 1000;

export function isEvaluationPendingFresh(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() < PENDING_EVALUATION_STALE_MS;
}

export async function expireStalePendingEvaluationsForUser(
  prisma: DbClient,
  userId: string
): Promise<void> {
  const threshold = new Date(Date.now() - PENDING_EVALUATION_STALE_MS);
  await prisma.tournamentUserEvaluation.updateMany({
    where: {
      userId,
      status: 'PENDING',
      createdAt: { lt: threshold },
    },
    data: {
      status: 'FAILED',
      errorMessage: 'Generation timed out',
    },
  });
}
