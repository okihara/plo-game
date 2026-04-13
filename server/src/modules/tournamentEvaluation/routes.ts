import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { fetchTournamentHandsForUser } from '../history/tournamentHandsForUser.js';
import { getJstDateString } from './jstDate.js';
import { generateTournamentEvaluationMarkdown } from './callEvalLlm.js';

export async function tournamentEvaluationRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  fastify.get('/quota', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };
    const jstToday = getJstDateString();
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tournamentEvalConsumedJstDate: true },
    });
    const consumedToday = user?.tournamentEvalConsumedJstDate === jstToday;
    return {
      timezone: 'Asia/Tokyo',
      jstDate: jstToday,
      canGenerateToday: !consumedToday,
      llmConfigured: Boolean(env.TOURNAMENT_EVAL_OPENAI_API_KEY?.trim()),
    };
  });

  fastify.get('/eligible', async (request: FastifyRequest) => {
    const { userId } = request.user as { userId: string };

    const results = await prisma.tournamentResult.findMany({
      where: { userId },
      include: {
        tournament: {
          select: {
            id: true,
            name: true,
            status: true,
            completedAt: true,
            buyIn: true,
          },
        },
      },
    });

    const completed = results.filter(r => r.tournament.status === 'COMPLETED');
    if (completed.length === 0) {
      return { tournaments: [] };
    }

    const tournamentIds = completed.map(r => r.tournamentId);

    const handGroups = await prisma.handHistory.groupBy({
      by: ['tournamentId'],
      where: {
        tournamentId: { in: tournamentIds },
        players: { some: { userId } },
      },
      _count: { _all: true },
    });
    const handCountByTournament = new Map(
      handGroups.map(g => [g.tournamentId!, g._count._all])
    );

    const latestEvals = await prisma.tournamentUserEvaluation.findMany({
      where: {
        userId,
        tournamentId: { in: tournamentIds },
        status: 'COMPLETED',
      },
      orderBy: [{ tournamentId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['tournamentId'],
      select: {
        tournamentId: true,
        createdAt: true,
      },
    });
    const latestEvalAt = new Map(latestEvals.map(e => [e.tournamentId, e.createdAt]));

    const tournaments = completed
      .map(r => {
        const handCount = handCountByTournament.get(r.tournamentId) ?? 0;
        if (handCount === 0) return null;
        return {
          id: r.tournament.id,
          name: r.tournament.name,
          completedAt: r.tournament.completedAt,
          buyIn: r.tournament.buyIn,
          position: r.position,
          prize: r.prize,
          reentries: r.reentries,
          handCount,
          latestEvaluationAt: latestEvalAt.get(r.tournamentId)?.toISOString() ?? null,
        };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null)
      .sort((a, b) => {
        const ta = a.completedAt?.getTime() ?? 0;
        const tb = b.completedAt?.getTime() ?? 0;
        return tb - ta;
      });

    return { tournaments };
  });

  fastify.get('/by-tournament/:tournamentId', async (request: FastifyRequest, reply) => {
    const { userId } = request.user as { userId: string };
    const { tournamentId } = request.params as { tournamentId: string };

    const row = await prisma.tournamentUserEvaluation.findFirst({
      where: { userId, tournamentId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        content: true,
        model: true,
        promptVersion: true,
        createdAt: true,
      },
    });

    if (!row) {
      return reply.code(404).send({ error: 'No evaluation found' });
    }

    return {
      id: row.id,
      content: row.content,
      model: row.model,
      promptVersion: row.promptVersion,
      createdAt: row.createdAt.toISOString(),
    };
  });

  fastify.post('/generate', async (request: FastifyRequest, reply) => {
    const { userId } = request.user as { userId: string };
    const body = request.body as { tournamentId?: string };
    const tournamentId = body.tournamentId?.trim();
    if (!tournamentId) {
      return reply.code(400).send({ error: 'tournamentId is required' });
    }

    const jstToday = getJstDateString();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { tournamentEvalConsumedJstDate: true },
    });
    if (user?.tournamentEvalConsumedJstDate === jstToday) {
      return reply.code(429).send({
        error: 'Daily evaluation limit reached',
        code: 'EVAL_DAILY_LIMIT',
        nextJstDate: jstToday,
      });
    }

    if (!env.TOURNAMENT_EVAL_OPENAI_API_KEY?.trim()) {
      return reply.code(503).send({ error: 'Tournament evaluation LLM is not configured' });
    }

    const [tournament, result] = await Promise.all([
      prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true, name: true, status: true, buyIn: true },
      }),
      prisma.tournamentResult.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
        select: { position: true, prize: true, reentries: true },
      }),
    ]);

    if (!tournament || tournament.status !== 'COMPLETED') {
      return reply.code(400).send({ error: 'Tournament is not completed or not found' });
    }
    if (!result) {
      return reply.code(400).send({ error: 'No finalized result for this user' });
    }

    const hands = await fetchTournamentHandsForUser(prisma, tournamentId, userId);
    if (hands.length === 0) {
      return reply.code(400).send({ error: 'No hand history for this tournament' });
    }

    let markdown: string;
    let model: string;
    let promptVersion: string;
    try {
      const out = await generateTournamentEvaluationMarkdown({
        tournamentName: tournament.name,
        buyIn: tournament.buyIn,
        position: result.position,
        prize: result.prize,
        reentries: result.reentries,
        hands,
      });
      markdown = out.markdown;
      model = out.model;
      promptVersion = out.promptVersion;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'LLM request failed';
      console.error('[tournamentEvaluation] LLM error:', message);
      return reply.code(502).send({ error: 'Failed to generate evaluation', detail: message });
    }

    try {
      await prisma.$transaction(async tx => {
        const updated = await tx.user.updateMany({
          where: {
            id: userId,
            OR: [
              { tournamentEvalConsumedJstDate: null },
              { tournamentEvalConsumedJstDate: { not: jstToday } },
            ],
          },
          data: { tournamentEvalConsumedJstDate: jstToday },
        });
        if (updated.count === 0) {
          throw new Error('QUOTA_RACE');
        }
        await tx.tournamentUserEvaluation.create({
          data: {
            userId,
            tournamentId,
            status: 'COMPLETED',
            content: { markdown },
            model,
            promptVersion,
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'QUOTA_RACE') {
        return reply.code(429).send({
          error: 'Daily evaluation limit reached',
          code: 'EVAL_DAILY_LIMIT',
          nextJstDate: jstToday,
        });
      }
      console.error('[tournamentEvaluation] persist error:', e);
      return reply.code(500).send({ error: 'Failed to save evaluation' });
    }

    return {
      success: true,
      tournamentId,
      content: { markdown },
      model,
      promptVersion,
    };
  });
}
