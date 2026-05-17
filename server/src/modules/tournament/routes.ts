import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TournamentManager } from './TournamentManager.js';
import { createTournamentFromConfig } from './socket.js';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { maskName } from '../../shared/utils.js';
import { TournamentConfig, TournamentLobbyInfo, TournamentStatus } from './types.js';
import type { GameVariant } from '@plo/shared';

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
        include: {
          _count: { select: { registrations: true } },
          registrations: { select: { reentryCount: true } },
          results: {
            where: { position: 1 },
            take: 1,
            include: {
              user: { select: { username: true, displayName: true, avatarUrl: true, nameMasked: true } },
            },
          },
        },
        orderBy: { completedAt: 'desc' },
        take: 20,
      });

      const completedTournaments: TournamentLobbyInfo[] = dbCompleted.map(t => {
        const top = t.results[0];
        const winner = t.status === 'COMPLETED' && top
          ? {
              displayName: top.user.displayName || (top.user.nameMasked ? maskName(top.user.username) : top.user.username),
              avatarUrl: top.user.avatarUrl,
            }
          : null;
        return {
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
          startedAt: t.startedAt?.toISOString() ?? t.createdAt.toISOString(),
          isRegistrationOpen: false,
          allowReentry: t.allowReentry,
          maxReentries: t.maxReentries,
          totalReentries: t.registrations.reduce((sum, r) => sum + r.reentryCount, 0),
          reentryDeadlineLevel: t.reentryDeadlineLevel,
          winner,
          gameVariant: (t.gameVariant ?? 'plo') as GameVariant,
        };
      });

      // アクティブ（waiting含む）を先頭、その後に終了済みを開始時刻降順
      const finishedStatuses = new Set(['completed', 'cancelled']);
      const active = activeTournaments.filter(t => !finishedStatuses.has(t.status));
      const finished = [...activeTournaments.filter(t => finishedStatuses.has(t.status)), ...completedTournaments];
      finished.sort((a, b) => {
        const timeA = a.startedAt ?? a.scheduledStartTime ?? '';
        const timeB = b.startedAt ?? b.scheduledStartTime ?? '';
        return timeB.localeCompare(timeA);
      });
      const tournaments = [...active, ...finished];

      // オプショナル認証: ログイン済みならDB参加記録を返す
      let myTournamentId: string | null = null;
      let canReenterTournamentId: string | null = null;
      let myEliminatedTournamentId: string | null = null;
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
            const t = tournamentManager.getTournament(reg.tournamentId);
            const player = t?.getPlayer(userId);
            if (!player || player.status !== 'eliminated') {
              myTournamentId = reg.tournamentId;
            } else if (t?.canReenter(userId)) {
              // eliminated かつリエントリー可能
              canReenterTournamentId = reg.tournamentId;
            } else {
              // eliminated かつリエントリー不可（締切後）
              myEliminatedTournamentId = reg.tournamentId;
            }
          }
        }
      } catch {
        // 未認証 — myTournamentId は null のまま
      }

      // 終了済みトーナメントへの参加履歴
      let myFinishedTournamentIds: string[] = [];
      try {
        if (!myTournamentId) await request.jwtVerify(); // 上で認証済みならスキップされる
        const { userId } = request.user as { userId: string };
        const finishedIds = tournaments.filter(t => t.status === 'completed' || t.status === 'cancelled').map(t => t.id);
        if (finishedIds.length > 0) {
          const regs = await prisma.tournamentRegistration.findMany({
            where: { userId, tournamentId: { in: finishedIds } },
            select: { tournamentId: true },
          });
          myFinishedTournamentIds = regs.map(r => r.tournamentId);
        }
      } catch {
        // 未認証
      }

      return { tournaments, myTournamentId, canReenterTournamentId, myEliminatedTournamentId, myFinishedTournamentIds };
    });

    // トーナメント詳細（公開）
    // メモリにあれば進行中状態を返し、なければDBから取得（終了済み含む）
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id', async (request, reply) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (tournament) {
        const state = tournament.getClientState();
        const status = tournament.getStatus();
        if (status === 'completed') {
          return { ...state, status, results: tournament.getResults() };
        }
        return { ...state, status };
      }

      // DBから取得（終了済みトーナメント対応）
      const dbTournament = await prisma.tournament.findUnique({
        where: { id: request.params.id },
        include: {
          results: {
            include: { user: { select: { username: true, displayName: true, avatarUrl: true, nameMasked: true } } },
            orderBy: { position: 'asc' },
          },
          registrations: { select: { reentryCount: true } },
        },
      });
      if (!dbTournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      // リエントリー込みの総エントリー数
      const totalEntries = dbTournament.registrations.reduce(
        (sum, r) => sum + 1 + r.reentryCount, 0
      );

      return {
        tournamentId: dbTournament.id,
        name: dbTournament.name,
        status: dbTournament.status.toLowerCase(),
        totalPlayers: totalEntries,
        prizePool: dbTournament.prizePool,
        results: dbTournament.results.map(r => ({
          odId: r.userId,
          odName: r.user.displayName || (r.user.nameMasked ? maskName(r.user.username) : r.user.username),
          position: r.position,
          prize: r.prize,
          reentries: r.reentries,
          avatarUrl: r.user.avatarUrl,
        })),
      };
    });

    // 進行中トーナメントの卓ID一覧（観戦の卓切り替え用）。メモリに無い場合は空配列。
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id/tables', async (request) => {
      const tournament = tournamentManager.getTournament(request.params.id);
      if (!tournament) {
        return { tableIds: [] as string[] };
      }
      return { tableIds: tournament.getTableIdsSorted() };
    });

    // 自分のトーナメント結果（認証必須）
    // メモリにあればそちらを優先、なければDBから読む
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id/my-result', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { userId } = request.user as { userId: string };
      const tournamentId = request.params.id;

      // メモリ上のトーナメントを確認
      const memTournament = tournamentManager.getTournament(tournamentId);
      if (memTournament) {
        const player = memTournament.getPlayer(userId);
        if (player?.finishPosition) {
          const prize = memTournament.getPrizeForPosition(player.finishPosition);
          return {
            tournamentName: memTournament.config.name,
            position: memTournament.isRegistrationOpen() ? null : player.finishPosition,
            totalPlayers: memTournament.getTotalEntries(),
            prizeAmount: prize,
            playerName: player.displayName ?? player.odName,
          };
        }
      }

      // DBフォールバック
      const dbTournament = await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          registrations: { select: { reentryCount: true } },
        },
      });
      if (!dbTournament) {
        return reply.status(404).send({ error: 'Tournament not found' });
      }

      const myResult = await prisma.tournamentResult.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      });
      if (!myResult) {
        return reply.status(404).send({ error: 'Result not found' });
      }

      // ユーザー名を取得
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true, username: true },
      });

      // リエントリー込みの総エントリー数
      const totalEntries = dbTournament.registrations.reduce(
        (sum, r) => sum + 1 + r.reentryCount, 0
      );

      return {
        tournamentName: dbTournament.name,
        position: myResult.position,
        totalPlayers: totalEntries,
        prizeAmount: myResult.prize,
        playerName: user?.displayName ?? user?.username ?? undefined,
      };
    });

    // 自分のトーナメント内ハンド統計（last / best / worst hand）
    fastify.get<{ Params: { id: string } }>('/api/tournaments/:id/my-hand-stats', async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const { userId } = request.user as { userId: string };
      const tournamentId = request.params.id;

      // そのトーナメントの自分のハンドを profit 付きで取得
      const playerHands = await prisma.handHistoryPlayer.findMany({
        where: {
          userId,
          handHistory: { tournamentId },
        },
        include: {
          handHistory: {
            select: {
              id: true,
              blinds: true,
              communityCards: true,
              potSize: true,
              createdAt: true,
            },
          },
        },
        orderBy: { handHistory: { createdAt: 'desc' } },
      });

      if (playerHands.length === 0) {
        return { lastHand: null, bestHand: null, worstHand: null, totalHands: 0 };
      }

      const toHandSummary = (ph: typeof playerHands[number]) => ({
        handId: ph.handHistory.id,
        holeCards: ph.holeCards,
        communityCards: ph.handHistory.communityCards,
        finalHand: ph.finalHand,
        profit: ph.profit,
        potSize: ph.handHistory.potSize,
      });

      const lastHand = toHandSummary(playerHands[0]);

      // best / worst はそのハンドの BB で割った「BB換算 profit」で比較。
      // ブラインドが上がっていく MTT で、同じチップ損益でも序盤と終盤で重みが違うため。
      const profitInBB = (ph: typeof playerHands[number]) => {
        const bb = Number(ph.handHistory.blinds.split('/')[1]);
        return Number.isFinite(bb) && bb > 0 ? ph.profit / bb : ph.profit;
      };
      let bestIdx = 0;
      let worstIdx = 0;
      for (let i = 1; i < playerHands.length; i++) {
        if (profitInBB(playerHands[i]) > profitInBB(playerHands[bestIdx])) bestIdx = i;
        if (profitInBB(playerHands[i]) < profitInBB(playerHands[worstIdx])) worstIdx = i;
      }

      return {
        lastHand,
        bestHand: toHandSummary(playerHands[bestIdx]),
        worstHand: toHandSummary(playerHands[worstIdx]),
        totalHands: playerHands.length,
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

      // 既に登録済みの場合
      const existing = await prisma.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      });
      if (existing) {
        // eliminated 状態ならリエントリーAPIを使うべき
        const player = tournament.getPlayer(userId);
        if (player?.status === 'eliminated') {
          return reply.status(400).send({ error: 'リエントリーから再参加してください' });
        }
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

    // トーナメント リエントリー（認証必須、DB操作のみ）
    // テーブル着席はソケット接続時（tournament:request_state）に行う
    fastify.post<{ Params: { id: string } }>('/api/tournaments/:id/reenter', async (request, reply) => {
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

      if (!tournament.canReenter(userId)) {
        return reply.status(400).send({ error: 'リエントリーできません' });
      }

      const buyIn = tournament.config.buyIn;

      const maxReentries = tournament.config.maxReentries;

      try {
        await prisma.$transaction(async (tx) => {
          // DBの reentryCount で上限チェック（メモリとの不整合を防止）
          const reg = await tx.tournamentRegistration.findUnique({
            where: { tournamentId_userId: { tournamentId, userId } },
            select: { reentryCount: true },
          });
          if (!reg || reg.reentryCount >= maxReentries) {
            throw new Error('REENTRY_LIMIT_REACHED');
          }

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
          await tx.tournamentRegistration.update({
            where: { tournamentId_userId: { tournamentId, userId } },
            data: { reentryCount: { increment: 1 } },
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        const message = msg === 'INSUFFICIENT_BALANCE'
          ? '残高が不足しています'
          : msg === 'REENTRY_LIMIT_REACHED'
            ? 'リエントリー上限に達しています'
            : 'リエントリーに失敗しました';
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
          gameVariant: tournament.config.gameVariant,
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
