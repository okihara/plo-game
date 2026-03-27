import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TournamentManager } from './TournamentManager.js';
import { createTournamentFromConfig } from './socket.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { TournamentConfig, TournamentLobbyInfo, TournamentStatus } from './types.js';

/** 管理エンドポイント認証（ADMIN_SECRET ベース） */
async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = env.ADMIN_SECRET;
  if (!secret) return; // 未設定時はスキップ（開発環境用）

  const querySecret = (request.query as Record<string, string>).secret;
  if (querySecret !== secret) {
    return reply.status(403).send({ error: 'Forbidden' });
  }
}

/**
 * トーナメント REST API ルート
 */
export function tournamentRoutes(deps: { tournamentManager: TournamentManager }) {
  return async function (fastify: FastifyInstance) {
    const { tournamentManager } = deps;

    // トーナメント一覧（公開、認証済みなら参加中トーナメントIDも返す）
    fastify.get('/api/tournaments', async (request) => {
      // メモリ上のアクティブトーナメント
      const activeTournaments = tournamentManager.getActiveTournaments();
      const activeIds = new Set(activeTournaments.map(t => t.id));

      // DBから終了済みトーナメントを取得（新しい順、最大20件）
      const dbCompleted = await prisma.tournament.findMany({
        where: {
          status: { in: ['COMPLETED', 'CANCELLED'] },
          id: { notIn: [...activeIds] },
        },
        include: { _count: { select: { registrations: true } } },
        orderBy: { completedAt: 'desc' },
        take: 20,
      });

      const completedTournaments: TournamentLobbyInfo[] = dbCompleted.map(t => ({
        id: t.id,
        name: t.name,
        status: t.status.toLowerCase() as TournamentStatus,
        buyIn: t.buyIn,
        startingChips: t.startingChips,
        registeredPlayers: t._count.registrations,
        maxPlayers: t.maxPlayers,
        currentBlindLevel: 0,
        prizePool: t.prizePool,
        scheduledStartTime: t.scheduledStartTime?.toISOString(),
        startedAt: t.startedAt?.toISOString(),
        isRegistrationOpen: false,
      }));

      // アクティブ → 終了済み の順（新しい順）
      const tournaments = [...activeTournaments, ...completedTournaments];

      // オプショナル認証: ログイン済みならDB参加記録を返す
      let myTournamentId: string | null = null;
      try {
        await request.jwtVerify();
        const { userId } = request.user as { userId: string };
        // 進行中トーナメントへの参加記録を検索
        const activeTournamentIds = activeTournaments
          .filter(t => t.status !== 'completed' && t.status !== 'cancelled')
          .map(t => t.id);
        if (activeTournamentIds.length > 0) {
          const reg = await prisma.tournamentRegistration.findFirst({
            where: { userId, tournamentId: { in: activeTournamentIds } },
            select: { tournamentId: true },
          });
          if (reg) {
            // メモリ上のプレイヤー状態を確認（eliminatedなら表示しない）
            const t = tournamentManager.getTournament(reg.tournamentId);
            const player = t?.getPlayer(userId);
            if (!player || player.status !== 'eliminated') {
              myTournamentId = reg.tournamentId;
            }
          }
        }
      } catch {
        // 未認証 — myTournamentId は null のまま
      }

      return { tournaments, myTournamentId };
    });

    // トーナメント詳細（公開）
    // メモリにあれば進行中状態を返し、なければDBから取得（終了済み含む）
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (tournament) {
        return tournament.getClientState();
      }

      // DBから取得（終了済みトーナメント対応）
      const dbTournament = await prisma.tournament.findUnique({
        where: { id: request.params.id },
        include: {
          results: {
            include: { user: { select: { username: true, displayName: true } } },
            orderBy: { position: 'asc' },
          },
          _count: { select: { registrations: true } },
        },
      });
      if (!dbTournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      return {
        tournamentId: dbTournament.id,
        name: dbTournament.name,
        status: dbTournament.status.toLowerCase(),
        totalPlayers: dbTournament._count.registrations,
        prizePool: dbTournament.prizePool,
        results: dbTournament.results.map(r => ({
          odId: r.userId,
          odName: r.user.displayName || r.user.username,
          position: r.position,
          prize: r.prize,
          reentries: r.reentries,
        })),
      };
    });

    // トーナメント参加登録（認証必須、DB操作のみ）
    // テーブル着席はソケット接続時（tournament:request_state）に行う
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/register', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { userId } = request.user as { userId: string };
      const tournamentId = request.params.id;
      const tournament = tournamentManager.getTournament(tournamentId);
      if (!tournament) {
        return reply.status(404).send({ error: 'トーナメントが見つかりません' });
      }

      if (!tournament.isRegistrationOpen()) {
        return reply.status(400).send({ error: 'トーナメントの登録受付は終了しています' });
      }

      // 既に登録済みならスキップ
      const existing = await prisma.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      });
      if (existing) {
        return { success: true, tournamentId };
      }

      const buyIn = tournament.config.buyIn;

      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.bankroll.updateMany({
            where: { userId, balance: { gte: buyIn } },
            data: { balance: { decrement: buyIn } },
          });
          if (updated.count === 0) {
            throw new Error('INSUFFICIENT_BALANCE');
          }
          await tx.transaction.create({
            data: { userId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
          });
          await tx.tournamentRegistration.create({
            data: { tournamentId, userId },
          });
        });
      } catch (err) {
        const message = err instanceof Error && err.message === 'INSUFFICIENT_BALANCE'
          ? '残高が不足しています'
          : '登録に失敗しました';
        return reply.status(400).send({ error: message });
      }

      return { success: true, tournamentId };
    });

    // トーナメント作成（管理者用）
    fastify.post<{ Body: Partial<TournamentConfig> }>('/api/tournaments', { preHandler: requireAdmin }, async (request) => {
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
          registrationLevels: tournament.config.registrationLevels,
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
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/start', { preHandler: requireAdmin }, async (request, reply) => {
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
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/cancel', { preHandler: requireAdmin }, async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (!tournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      tournament.cancel();

      // バイイン返還 + ステータス更新をトランザクションで一括処理
      await prisma.$transaction(async (tx) => {
        const registrations = await tx.tournamentRegistration.findMany({
          where: { tournamentId: request.params.id },
        });

        for (const reg of registrations) {
          await tx.bankroll.update({
            where: { userId: reg.userId },
            data: { balance: { increment: tournament.config.buyIn * (1 + reg.reentryCount) } },
          });
        }

        await tx.tournament.update({
          where: { id: request.params.id },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
      });

      return { success: true };
    });
  };
}
