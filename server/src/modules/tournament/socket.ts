import { nanoid } from 'nanoid';
import { PrismaClient } from '@prisma/client';
import { TournamentManager } from './TournamentManager.js';
import { TournamentConfig } from './types.js';
import { DEFAULT_BLIND_SCHEDULE, DEFAULT_STARTING_CHIPS, DEFAULT_BUY_IN, DEFAULT_MIN_PLAYERS, DEFAULT_MAX_PLAYERS, DEFAULT_REGISTRATION_LEVELS, DEFAULT_MAX_REENTRIES, PLAYERS_PER_TABLE } from './constants.js';
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
  // DB登録済みだがメモリ未着席のプレイヤーは自動的にenterPlayerで着席させる
  socket.on('tournament:request_state', async (data: { tournamentId: string }) => {
    const tournament = tournamentManager.getTournament(data.tournamentId);
    if (!tournament) return;

    let player = tournament.getPlayer(odId);

    // DB登録済みだがメモリ未着席 → enterPlayerで着席
    if (!player) {
      const reg = await prisma.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
      });
      if (!reg) return;

      const user = await prisma.user.findUnique({
        where: { id: odId },
        select: { username: true, displayName: true, avatarUrl: true, nameMasked: true },
      });
      if (!user) return;

      const statusBefore = tournament.getStatus();
      const result = tournament.enterPlayer(odId, user.username, socket, {
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        nameMasked: user.nameMasked,
      });
      if (!result.success) {
        socket.emit('tournament:error', { message: result.error ?? '参加に失敗しました' });
        return;
      }
      tournamentManager.setPlayerTournament(odId, data.tournamentId);

      // enterPlayer 内で自動開始された場合のDB更新
      if (statusBefore === 'waiting' && tournament.getStatus() === 'running') {
        prisma.tournament.update({
          where: { id: data.tournamentId },
          data: { status: 'RUNNING', startedAt: new Date() },
        }).catch(err => console.error('[Tournament] Failed to update DB on auto-start:', err));
      }

      player = tournament.getPlayer(odId)!;
    } else if (player.status === 'eliminated') {
      // eliminated プレイヤー: REST でリエントリー課金済みならメモリ側のリエントリーを実行
      const reg = await prisma.tournamentRegistration.findUnique({
        where: { tournamentId_userId: { tournamentId: data.tournamentId, userId: odId } },
        select: { reentryCount: true },
      });
      if (reg && reg.reentryCount > player.reentryCount) {
        // DB課金済み → enterPlayer でリエントリー（handleReentry が呼ばれる）
        const result = tournament.enterPlayer(odId, player.odName, socket);
        if (!result.success) {
          socket.emit('tournament:error', { message: result.error ?? 'リエントリーに失敗しました' });
          return;
        }
        player = tournament.getPlayer(odId)!;
      } else {
        // リエントリーしていない eliminated → ソケット更新のみ（ルーム参加しない）
        player.socket = socket;
        // eliminated かつリエントリー不可の場合はエラーを返す
        if (!tournament.canReenter(odId)) {
          socket.emit('tournament:error', { message: 'リエントリー上限に達しています' });
          return;
        }
        socket.join(`tournament:${data.tournamentId}`);
      }
    } else {
      // 既存プレイヤー: ソケット更新（ページ遷移でリスナーが変わるため）
      player.socket = socket;
      socket.join(`tournament:${data.tournamentId}`);
    }

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
    allowReentry: options?.allowReentry ?? true,
    maxReentries: options?.maxReentries ?? DEFAULT_MAX_REENTRIES,
    reentryDeadlineLevel: options?.reentryDeadlineLevel ?? DEFAULT_REGISTRATION_LEVELS,
  };

  tournamentManager.createTournament(config);
  return id;
}
