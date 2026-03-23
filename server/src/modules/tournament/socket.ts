import { nanoid } from 'nanoid';
import { TournamentManager } from './TournamentManager.js';
import { TournamentConfig } from './types.js';
import { DEFAULT_BLIND_SCHEDULE, DEFAULT_STARTING_CHIPS, DEFAULT_BUY_IN, DEFAULT_MIN_PLAYERS, DEFAULT_MAX_PLAYERS, DEFAULT_LATE_REGISTRATION_LEVELS, PLAYERS_PER_TABLE } from './constants.js';
import { AuthenticatedSocket } from '../game/authMiddleware.js';
import { prisma } from '../../config/database.js';

/**
 * 個別のソケットにトーナメントイベントハンドラを登録する
 * game/socket.ts の connection ハンドラ内から呼び出す
 */
export function registerTournamentHandlers(
  socket: AuthenticatedSocket,
  tournamentManager: TournamentManager
): void {
  const odId = socket.odId!;

  // トーナメント一覧取得
  socket.on('tournament:list', () => {
    const tournaments = tournamentManager.getActiveTournaments();
    socket.emit('tournament:list', { tournaments });
  });

  // トーナメント参加登録
  socket.on('tournament:register', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) {
      socket.emit('tournament:error', { message: 'トーナメントが見つかりません' });
      return;
    }

    // ユーザー情報 + 残高チェック
    const user = await prisma.user.findUnique({
      where: { id: odId },
      include: { bankroll: true },
    });
    if (!user?.bankroll || user.bankroll.balance < tournament.config.buyIn) {
      socket.emit('tournament:error', { message: 'チップが不足しています' });
      return;
    }

    // DB操作をトランザクションで実行（失敗時はロールバック）
    try {
      await prisma.$transaction(async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { decrement: tournament.config.buyIn } },
        });
        await tx.transaction.create({
          data: {
            userId: odId,
            type: 'TOURNAMENT_BUY_IN',
            amount: -tournament.config.buyIn,
          },
        });
        await tx.tournamentRegistration.upsert({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          create: { tournamentId: data.tournamentId, userId: odId },
          update: {},
        });
      });
    } catch (err) {
      console.error(`[Tournament] Registration DB error for ${odId}:`, err);
      socket.emit('tournament:error', { message: 'データベースエラーが発生しました' });
      return;
    }

    // DB成功後にメモリ登録（DB失敗時はメモリ汚染しない）
    const result = tournament.registerPlayer(odId, user.username, socket, {
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      nameMasked: user.nameMasked,
    });

    if (!result.success) {
      // メモリ登録失敗時はDB操作をロールバック
      await prisma.$transaction(async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: tournament.config.buyIn } },
        });
        await tx.transaction.create({
          data: {
            userId: odId,
            type: 'TOURNAMENT_BUY_IN',
            amount: tournament.config.buyIn,
          },
        });
        await tx.tournamentRegistration.deleteMany({
          where: { tournamentId: data.tournamentId, userId: odId },
        });
      });
      socket.emit('tournament:error', { message: result.error });
      return;
    }

    tournamentManager.setPlayerTournament(odId, data.tournamentId);
    socket.emit('tournament:registered', { tournamentId: data.tournamentId });
  });

  // トーナメント登録解除
  socket.on('tournament:unregister', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) {
      socket.emit('tournament:error', { message: 'トーナメントが見つかりません' });
      return;
    }

    const result = tournament.unregisterPlayer(odId);
    if (!result.success) {
      socket.emit('tournament:error', { message: result.error });
      return;
    }

    // バイイン返還（トランザクション）
    try {
      await prisma.$transaction(async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: tournament.config.buyIn } },
        });
        await tx.transaction.create({
          data: {
            userId: odId,
            type: 'TOURNAMENT_BUY_IN',
            amount: tournament.config.buyIn,
          },
        });
        await tx.tournamentRegistration.deleteMany({
          where: { tournamentId: data.tournamentId, userId: odId },
        });
      });
    } catch (err) {
      console.error(`[Tournament] Unregister DB error for ${odId}:`, err);
      // メモリ上の登録解除は完了しているためエラー通知のみ
    }

    tournamentManager.removePlayerFromTracking(odId);
    socket.emit('tournament:unregistered', { tournamentId: data.tournamentId });
  });

  // リエントリー
  socket.on('tournament:reenter', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) {
      socket.emit('tournament:error', { message: 'トーナメントが見つかりません' });
      return;
    }

    // 残高チェック
    const bankroll = await prisma.bankroll.findUnique({ where: { userId: odId } });
    if (!bankroll || bankroll.balance < tournament.config.buyIn) {
      socket.emit('tournament:error', { message: 'チップが不足しています' });
      return;
    }

    // DB操作をトランザクションで実行
    try {
      await prisma.$transaction(async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { decrement: tournament.config.buyIn } },
        });
        await tx.transaction.create({
          data: {
            userId: odId,
            type: 'TOURNAMENT_BUY_IN',
            amount: -tournament.config.buyIn,
          },
        });
        await tx.tournamentRegistration.update({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          data: { reentryCount: { increment: 1 } },
        });
      });
    } catch (err) {
      console.error(`[Tournament] Reentry DB error for ${odId}:`, err);
      socket.emit('tournament:error', { message: 'データベースエラーが発生しました' });
      return;
    }

    // DB成功後にメモリ上のリエントリー処理
    const result = tournament.reenterPlayer(odId, socket);
    if (!result.success) {
      // ロールバック
      await prisma.$transaction(async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: tournament.config.buyIn } },
        });
        await tx.transaction.create({
          data: {
            userId: odId,
            type: 'TOURNAMENT_BUY_IN',
            amount: tournament.config.buyIn,
          },
        });
        await tx.tournamentRegistration.update({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          data: { reentryCount: { decrement: 1 } },
        });
      });
      socket.emit('tournament:error', { message: result.error });
      return;
    }
  });

  // トーナメントゲーム中のアクション（game:action はキャッシュゲームと共通）
  // → game/socket.ts の game:action ハンドラで処理される
  // トーナメントテーブルも TableInstance を使っているため追加対応不要
}

/**
 * トーナメント作成用ヘルパー（管理API等から呼び出す）
 */
export function createTournamentFromConfig(
  tournamentManager: TournamentManager,
  options?: Partial<TournamentConfig>
): string {
  const id = nanoid(12);
  const config: TournamentConfig = {
    id,
    name: options?.name ?? `Tournament #${id.slice(0, 4)}`,
    buyIn: options?.buyIn ?? DEFAULT_BUY_IN,
    startingChips: options?.startingChips ?? DEFAULT_STARTING_CHIPS,
    minPlayers: options?.minPlayers ?? DEFAULT_MIN_PLAYERS,
    maxPlayers: options?.maxPlayers ?? DEFAULT_MAX_PLAYERS,
    playersPerTable: options?.playersPerTable ?? PLAYERS_PER_TABLE,
    blindSchedule: options?.blindSchedule ?? DEFAULT_BLIND_SCHEDULE,
    lateRegistrationLevels: options?.lateRegistrationLevels ?? DEFAULT_LATE_REGISTRATION_LEVELS,
    payoutPercentage: options?.payoutPercentage ?? [],
    startCondition: options?.startCondition ?? 'manual',
    scheduledStartTime: options?.scheduledStartTime,
    requiredPlayerCount: options?.requiredPlayerCount,
    allowReentry: options?.allowReentry ?? false,
    maxReentries: options?.maxReentries ?? 0,
    reentryDeadlineLevel: options?.reentryDeadlineLevel ?? 4,
  };

  tournamentManager.createTournament(config);
  return id;
}
