import { nanoid } from 'nanoid';
import { PrismaClient } from '@prisma/client';
import { TournamentManager } from './TournamentManager.js';
import { TournamentConfig } from './types.js';
import { DEFAULT_BLIND_SCHEDULE, DEFAULT_STARTING_CHIPS, DEFAULT_BUY_IN, DEFAULT_MIN_PLAYERS, DEFAULT_MAX_PLAYERS, DEFAULT_REGISTRATION_LEVELS, PLAYERS_PER_TABLE } from './constants.js';
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
    // 残高不足は想定内エラー — ユーザー向けメッセージで返す
    if (err instanceof Error && err.message === 'INSUFFICIENT_BALANCE') {
      return { success: false, error: 'チップが不足しています' };
    }
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

  // トーナメントテーブルの状態を再送信（ページ遷移でゲーム画面に入った時用）
  socket.on('tournament:request_state', (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) return;

    const player = tournament.getPlayer(odId);
    if (!player) return;

    // ソケット更新（ページ遷移でリスナーが変わるため）
    player.socket = socket;
    socket.join(`tournament:${data.tournamentId}`);

    // トーナメント状態を送信
    socket.emit('tournament:state', tournament.getClientState(odId));

    // テーブルに着席済みなら game:state も再送信
    if (player.tableId) {
      const table = tournament.getTable(player.tableId);
      if (table) {
        table.reconnectPlayer(odId, socket);
      }
    }
  });

  // トーナメント参加登録
  socket.on('tournament:register', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) {
      socket.emit('tournament:error', { message: 'トーナメントが見つかりません' });
      return;
    }

    // 既に登録済みなら再接続として処理（切断復帰フロー）
    const existingPlayer = tournament.getPlayer(odId);
    if (existingPlayer) {
      if (existingPlayer.status === 'eliminated') {
        socket.emit('tournament:error', { message: 'このトーナメントでは既に敗退しています' });
        return;
      }
      tournament.handleReconnect(odId, socket);
      tournamentManager.setPlayerTournament(odId, data.tournamentId);
      socket.emit('tournament:registered', { tournamentId: data.tournamentId });
      return;
    }

    const buyIn = tournament.config.buyIn;

    // ユーザー情報を取得（残高チェックはトランザクション内で行う）
    const user = await prisma.user.findUnique({
      where: { id: odId },
      select: { username: true, displayName: true, avatarUrl: true, nameMasked: true },
    });
    if (!user) {
      socket.emit('tournament:error', { message: 'ユーザーが見つかりません' });
      return;
    }

    const result = await withDbAndMemory({
      label: 'Register',
      odId,
      dbOps: async (tx) => {
        // 残高チェックをトランザクション内で行いレースコンディションを防止
        const updated = await tx.bankroll.updateMany({
          where: { userId: odId, balance: { gte: buyIn } },
          data: { balance: { decrement: buyIn } },
        });
        if (updated.count === 0) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
        });
        await tx.tournamentRegistration.upsert({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          create: { tournamentId: data.tournamentId, userId: odId },
          update: {},
        });
      },
      memoryOp: () => {
        return tournament.enterPlayer(odId, user.username, socket, {
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          nameMasked: user.nameMasked,
        });
      },
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

  // リエントリー
  socket.on('tournament:reenter', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) {
      socket.emit('tournament:error', { message: 'トーナメントが見つかりません' });
      return;
    }

    const buyIn = tournament.config.buyIn;
    const result = await withDbAndMemory({
      label: 'Reentry',
      odId,
      dbOps: async (tx) => {
        // 残高チェックをトランザクション内で行いレースコンディションを防止
        const updated = await tx.bankroll.updateMany({
          where: { userId: odId, balance: { gte: buyIn } },
          data: { balance: { decrement: buyIn } },
        });
        if (updated.count === 0) {
          throw new Error('INSUFFICIENT_BALANCE');
        }
        await tx.transaction.create({
          data: { userId: odId, type: 'TOURNAMENT_BUY_IN', amount: -buyIn },
        });
        await tx.tournamentRegistration.update({
          where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
          data: { reentryCount: { increment: 1 } },
        });
      },
      memoryOp: () => {
        const player = tournament.getPlayer(odId);
        return tournament.enterPlayer(odId, player?.odName ?? odId, socket);
      },
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
    registrationLevels: options?.registrationLevels ?? DEFAULT_REGISTRATION_LEVELS,
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
