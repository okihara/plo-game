import { FastifyInstance } from 'fastify';
import { TournamentManager } from './TournamentManager.js';
import { createTournamentFromConfig } from './socket.js';
import { prisma } from '../../config/database.js';
import { TournamentConfig } from './types.js';

/**
 * トーナメント REST API ルート
 */
export function tournamentRoutes(deps: { tournamentManager: TournamentManager }) {
  return async function (fastify: FastifyInstance) {
    const { tournamentManager } = deps;

    // トーナメント一覧
    fastify.get('/api/tournaments', async () => {
      return { tournaments: tournamentManager.getActiveTournaments() };
    });

    // トーナメント詳細
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (!tournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }
      return tournament.getClientState();
    });

    // トーナメント作成（管理者用）
    fastify.post<{ Body: Partial<TournamentConfig> }>('/api/tournaments', async (request) => {
      const tournamentId = createTournamentFromConfig(tournamentManager, request.body);
      const tournament = tournamentManager.getTournament(tournamentId)!;

      // DB保存
      await prisma.tournament.create({
        data: {
          id: tournamentId,
          name: tournament.config.name,
          buyIn: tournament.config.buyIn,
          startingChips: tournament.config.startingChips,
          minPlayers: tournament.config.minPlayers,
          maxPlayers: tournament.config.maxPlayers,
          blindSchedule: JSON.parse(JSON.stringify(tournament.config.blindSchedule)),
          lateRegistrationLevels: tournament.config.lateRegistrationLevels,
          payoutPercentage: JSON.parse(JSON.stringify(tournament.config.payoutPercentage)),
          allowReentry: tournament.config.allowReentry,
          maxReentries: tournament.config.maxReentries,
          reentryDeadlineLevel: tournament.config.reentryDeadlineLevel,
          scheduledStartTime: tournament.config.scheduledStartTime,
        },
      });

      return { tournamentId, name: tournament.config.name };
    });

    // トーナメント開始（管理者用）
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/start', async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (!tournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      const result = tournament.start();
      if (!result.success) {
        return reply.status(400).send({ error: result.error });
      }

      // DB更新
      await prisma.tournament.update({
        where: { id: request.params.id },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      return { success: true };
    });

    // トーナメントキャンセル（管理者用）
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/cancel', async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (!tournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      tournament.cancel();

      // バイイン返還処理
      const registrations = await prisma.tournamentRegistration.findMany({
        where: { tournamentId: request.params.id },
      });

      for (const reg of registrations) {
        await prisma.bankroll.update({
          where: { userId: reg.userId },
          data: { balance: { increment: tournament.config.buyIn * (1 + reg.reentryCount) } },
        });
      }

      // DB更新
      await prisma.tournament.update({
        where: { id: request.params.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });

      return { success: true };
    });
  };
}
