import { nanoid } from 'nanoid';
import { PrismaClient } from '@prisma/client';
import { TournamentManager } from './TournamentManager.js';
import { TournamentConfig } from './types.js';
import { DEFAULT_BLIND_SCHEDULE, DEFAULT_STARTING_CHIPS, DEFAULT_BUY_IN, DEFAULT_MIN_PLAYERS, DEFAULT_MAX_PLAYERS, DEFAULT_LATE_REGISTRATION_LEVELS, PLAYERS_PER_TABLE } from './constants.js';
import { AuthenticatedSocket } from '../game/authMiddleware.js';
import { prisma } from '../../config/database.js';

type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/**
 * バイイン関連のDB操作（課金/返金）とメモリ操作を安全に連携するヘルパー。
 *
 * 1. dbOps でDB変更（トランザクション内）
 * 2. memoryOp でメモリ変更（DB成功後）
 * 3. memoryOp 失敗時は compensate でDBを巻き戻す
 */
async function withDbAndMemory(opts: {
  dbOps: (tx: PrismaTx) => Promise<void>;
  memoryOp: () => { success: boolean; error?: string };
  compensate: (tx: PrismaTx) => Promise<void>;
  label: string;
  odId: string;
}): Promise<{ success: boolean; error?: string }> {
  const { dbOps, memoryOp, compensate, label, odId } = opts;

  // 1. DB操作
  try {
    await prisma.$transaction(dbOps);
  } catch (err) {
    console.error(`[Tournament] ${label} DB error for ${odId}:`, err);
    return { success: false, error: 'データベースエラーが発生しました' };
  }

  // 2. メモリ操作
  const result = memoryOp();
  if (!result.success) {
    // 3. 補償トランザクション
    try {
      await prisma.$transaction(compensate);
    } catch (err) {
      console.error(`[Tournament] ${label} rollback error for ${odId}:`, err);
    }
    return result;
  }

  return { success: true };
}

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

    const buyIn = tournament.config.buyIn;
    const result = await withDbAndMemory({
      label: 'Register',
      odId,
      dbOps: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { decrement: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
        });
        await tx.tournamentRegistration.upsert({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          create: { tournamentId: data.tournamentId, userId: odId },
          update: {},
        });
      },
      memoryOp: () => tournament.registerPlayer(odId, user.username, socket, {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        nameMasked: user.nameMasked,
      }),
      compensate: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: buyIn },
        });
        await tx.tournamentRegistration.deleteMany({
          where: { tournamentId: data.tournamentId, userId: odId },
        });
      },
    });

    if (!result.success) {
      socket.emit('tournament:error', { message: result.error ?? '登録に失敗しました' });
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

    // 登録解除可能かチェック（メモリ操作はまだしない）
    if (tournament.getStatus() !== 'registering') {
      socket.emit('tournament:error', { message: 'トーナメント開始後は登録解除できません' });
      return;
    }
    if (!tournament.getPlayer(odId)) {
      socket.emit('tournament:error', { message: '登録されていません' });
      return;
    }

    const buyIn = tournament.config.buyIn;
    const result = await withDbAndMemory({
      label: 'Unregister',
      odId,
      dbOps: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: buyIn },
        });
        await tx.tournamentRegistration.deleteMany({
          where: { tournamentId: data.tournamentId, userId: odId },
        });
      },
      memoryOp: () => tournament.unregisterPlayer(odId),
      compensate: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { decrement: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
        });
        await tx.tournamentRegistration.upsert({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          create: { tournamentId: data.tournamentId, userId: odId },
          update: {},
        });
      },
    });

    if (!result.success) {
      socket.emit('tournament:error', { message: result.error ?? '登録解除に失敗しました' });
      return;
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

    const buyIn = tournament.config.buyIn;
    const result = await withDbAndMemory({
      label: 'Reentry',
      odId,
      dbOps: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { decrement: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
        });
        await tx.tournamentRegistration.update({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          data: { reentryCount: { increment: 1 } },
        });
      },
      memoryOp: () => tournament.reenterPlayer(odId, socket),
      compensate: async (tx) => {
        await tx.bankroll.update({
          where: { userId: odId },
          data: { balance: { increment: buyIn } },
        });
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: buyIn },
        });
        await tx.tournamentRegistration.update({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          data: { reentryCount: { decrement: 1 } },
        });
      },
    });

    if (!result.success) {
      socket.emit('tournament:error', { message: result.error ?? 'リエントリーに失敗しました' });
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
