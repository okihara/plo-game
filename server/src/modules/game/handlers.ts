import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { cashOutPlayer, deductBuyIn } from '../auth/bankroll.js';
import { AuthenticatedSocket } from './authMiddleware.js';
import { handleFastFoldMove, setupFastFoldCallback } from './fastFoldService.js';
import { hasWeeklyChampionBadge } from '../badges/badgeService.js';

const SPECTATE_JOIN_WINDOW_MS = 60_000;
const SPECTATE_JOIN_MAX_PER_WINDOW = 30;
const spectateJoinTimestamps = new Map<string, number[]>();

function checkSpectateRateLimit(odId: string): boolean {
  const now = Date.now();
  let arr = spectateJoinTimestamps.get(odId) ?? [];
  arr = arr.filter((t) => now - t < SPECTATE_JOIN_WINDOW_MS);
  if (arr.length >= SPECTATE_JOIN_MAX_PER_WINDOW) {
    return false;
  }
  arr.push(now);
  spectateJoinTimestamps.set(odId, arr);
  return true;
}

function resolveTableInstance(
  tableId: string,
  tableManager: TableManager,
  tournamentManager: TournamentManager
): TableInstance | undefined {
  const cash = tableManager.getTable(tableId);
  if (cash) return cash;
  return tournamentManager.findTableInstanceByTableId(tableId);
}

// テーブルから離席してキャッシュアウトする共通処理
export async function unseatAndCashOut(table: TableInstance, odId: string, tableManager: TableManager): Promise<void> {
  const result = table.unseatPlayer(odId);
  tableManager.removePlayerFromTracking(odId);
  if (result) {
    await cashOutPlayer(result.odId, result.chips, table.id);
  }
  // プライベートテーブルが空になったら自動削除
  if (table.isPrivate && table.getPlayerCount() === 0) {
    console.log(`[Private] Table ${table.id} (code: ${table.inviteCode}) removed (empty)`);
    tableManager.removeTable(table.id);
  }
}

export async function handleTableLeave(socket: AuthenticatedSocket, tableManager: TableManager): Promise<void> {
  const table = tableManager.getPlayerTable(socket.odId!);
  if (table) {
    await unseatAndCashOut(table, socket.odId!, tableManager);
    socket.emit('table:left');
  } else {
    console.warn(`[table:leave] Player ${socket.odId} tried to leave but not seated at any table`);
  }
}

export async function handleGameAction(
  socket: AuthenticatedSocket,
  data: { action: Action; amount?: number; discardIndices?: number[] },
  tableManager: TableManager,
  tournamentManager?: TournamentManager
): Promise<void> {
  // キャッシュゲームテーブルを先に探し、なければトーナメントテーブルを探す
  let table = tableManager.getPlayerTable(socket.odId!);
  if (!table && tournamentManager) {
    const tournamentId = tournamentManager.getPlayerTournament(socket.odId!);
    if (tournamentId) {
      const tournament = tournamentManager.getTournament(tournamentId);
      const player = tournament?.getPlayer(socket.odId!);
      if (player?.tableId) {
        table = tournament?.getTable(player.tableId);
      }
    }
  }
  if (!table) {
    socket.emit('table:error', { message: 'Not seated at a table' });
    return;
  }

  const success = table.handleAction(socket.odId!, data.action, data.amount || 0, data.discardIndices);
  if (!success) {
    socket.emit('table:error', { message: 'Invalid action' });
    return;
  }

  // ファストフォールド: フォールド後に別テーブルへ移動
  if (table.isFastFold && data.action === 'fold') {
    try {
      await handleFastFoldMove(socket, table, socket.odId!, tableManager);
    } catch (err) {
      console.error('[FastFold] move failed:', err);
    }
  }
}

export async function handleFastFold(socket: AuthenticatedSocket, tableManager: TableManager): Promise<void> {
  const table = tableManager.getPlayerTable(socket.odId!);
  if (!table) {
    socket.emit('table:error', { message: 'Not seated at a table' });
    return;
  }

  if (!table.isFastFold) {
    socket.emit('table:error', { message: 'Fast fold not available' });
    return;
  }

  const success = table.handleEarlyFold(socket.odId!);
  if (!success) {
    return;
  }

  try {
    await handleFastFoldMove(socket, table, socket.odId!, tableManager);
  } catch (err) {
    console.error('[FastFold] early fold move failed:', err);
  }
}

export async function handleDisconnect(socket: AuthenticatedSocket, tableManager: TableManager): Promise<void> {
  try {
    const table = tableManager.getPlayerTable(socket.odId!);
    if (table) {
      await unseatAndCashOut(table, socket.odId!, tableManager);
    }
  } catch (err) {
    console.error(`Error during disconnect cleanup for ${socket.odId}:`, err);
  }
}

/** 観戦ソケット切断時: ルーム退出のみ（着席プレイヤーのキャッシュアウトはしない） */
export function handleSpectatorDisconnect(
  socket: AuthenticatedSocket,
  tableManager: TableManager,
  tournamentManager: TournamentManager
): void {
  const tableId = socket.odSpectatingTableId;
  if (!tableId) return;
  const table = resolveTableInstance(tableId, tableManager, tournamentManager);
  table?.removeSpectator(socket);
  if (table?.tournamentId) {
    socket.leave(`tournament:${table.tournamentId}`);
  }
  socket.odSpectatingTableId = null;
}

export function handleSpectateJoin(
  socket: AuthenticatedSocket,
  data: { tableId?: string; inviteCode?: string },
  tableManager: TableManager,
  tournamentManager: TournamentManager
): void {
  if (maintenanceService.isMaintenanceActive()) {
    socket.emit('table:error', { message: 'メンテナンス中のため観戦できません' });
    return;
  }
  if (socket.odConnectionMode !== 'spectate') {
    socket.emit('table:error', { message: '観戦には観戦用の接続が必要です' });
    return;
  }
  const odId = socket.odId;
  if (!odId) {
    socket.emit('table:error', { message: '認証が必要です' });
    return;
  }
  const tableId = data.tableId?.trim();
  if (!tableId) {
    socket.emit('table:error', { message: 'テーブルIDが必要です' });
    return;
  }

  const table = resolveTableInstance(tableId, tableManager, tournamentManager);
  if (!table) {
    socket.emit('table:error', { message: 'テーブルが見つかりません' });
    return;
  }

  if (table.isPrivate) {
    const code = data.inviteCode?.toUpperCase().trim();
    if (!code || code !== table.inviteCode) {
      socket.emit('table:error', { message: '招待コードが必要です' });
      return;
    }
  }

  if (!checkSpectateRateLimit(odId)) {
    socket.emit('table:error', { message: 'リクエストが多すぎます。しばらく待ってからお試しください' });
    return;
  }

  if (socket.odSpectatingTableId && socket.odSpectatingTableId !== table.id) {
    const prev = resolveTableInstance(socket.odSpectatingTableId, tableManager, tournamentManager);
    prev?.removeSpectator(socket);
    if (prev?.tournamentId && prev.tournamentId !== table.tournamentId) {
      socket.leave(`tournament:${prev.tournamentId}`);
    }
    socket.odSpectatingTableId = null;
  }

  const result = table.addSpectator(socket);
  if (!result.ok) {
    socket.emit('table:error', { message: result.message });
    return;
  }

  socket.odSpectatingTableId = table.id;
  socket.emit('table:spectate_joined', { tableId: table.id });
  socket.emit('game:state', { state: table.getClientGameState() });

  // トーナメントテーブル観戦時はトーナメントルームにも join し、現在状態を 1 回送信。
  // 以降のレベル進行・人数変動は `tournament:${id}` への broadcast でそのまま届く。
  if (table.tournamentId) {
    const tournament = tournamentManager.getTournament(table.tournamentId);
    if (tournament) {
      socket.join(`tournament:${table.tournamentId}`);
      socket.emit('tournament:state', tournament.getClientState());
    }
  }
}

export function handleSpectateLeave(
  socket: AuthenticatedSocket,
  tableManager: TableManager,
  tournamentManager: TournamentManager
): void {
  if (socket.odConnectionMode !== 'spectate') {
    return;
  }
  handleSpectatorDisconnect(socket, tableManager, tournamentManager);
  socket.emit('table:spectate_left');
}

export async function handleMatchmakingJoin(
  socket: AuthenticatedSocket,
  data: { blinds: string; isFastFold?: boolean; variant?: string },
  tableManager: TableManager
): Promise<void> {
  if (maintenanceService.isMaintenanceActive()) {
    socket.emit('table:error', { message: 'メンテナンス中のため参加できません' });
    return;
  }

  const { blinds } = data;
  const VALID_VARIANTS: import('../../shared/logic/types.js').GameVariant[] = ['plo', 'stud', 'razz', 'limit_2-7_triple_draw', 'no_limit_2-7_single_draw', 'limit_holdem', 'omaha_hilo', 'stud_hilo'];
  const isHorse = data.variant === 'horse';
  const variant: import('../../shared/logic/types.js').GameVariant =
    isHorse ? 'limit_holdem' : (VALID_VARIANTS.includes(data.variant as any) ? (data.variant as any) : 'plo');

  try {
    const parts = blinds.split('/');
    if (parts.length !== 2 || parts.some(p => isNaN(Number(p)) || Number(p) <= 0)) {
      console.error(`[matchmaking:join] Invalid blinds format: "${blinds}", odId=${socket.odId}`);
      socket.emit('table:error', { message: 'Invalid blinds format' });
      return;
    }
    const [, bb] = parts.map(Number);
    const buyIn = bb * 100; // $300 for $1/$3

    // Check balance and get user info
    const user = await prisma.user.findUnique({
      where: { id: socket.odId },
      include: { bankroll: true },
    });

    if (!user?.bankroll || user.bankroll.balance < buyIn) {
      socket.emit('table:error', { message: 'Insufficient balance for minimum buy-in' });
      return;
    }

    // Leave current table if any (with cashout)
    const currentTable = tableManager.getPlayerTable(socket.odId!);
    if (currentTable) {
      await unseatAndCashOut(currentTable, socket.odId!, tableManager);
    }

    // Find available table or create one
    const isFastFold = data.isFastFold ?? false;
    const table = tableManager.getOrCreateTable(blinds, isFastFold, undefined, variant, isHorse);
    if (!table) {
      socket.emit('table:error', { message: 'テーブルが満席です' });
      return;
    }
    if (isFastFold) setupFastFoldCallback(table, tableManager);

    // Deduct buy-in
    const deducted = await deductBuyIn(socket.odId!, buyIn);
    if (!deducted) {
      socket.emit('table:error', { message: 'Insufficient balance for buy-in' });
      return;
    }

    // await中にソケットが切断された場合はゴーストプレイヤーを防ぐ
    if (!socket.connected) {
      console.warn(`[matchmaking] Socket disconnected during join for ${socket.odId}, refunding`);
      await cashOutPlayer(socket.odId!, buyIn);
      return;
    }

    // Seat player
    const weeklyChamp = await hasWeeklyChampionBadge(socket.odId!);
    const seatNumber = table.seatPlayer(
      socket.odId!,
      user.username,
      socket,
      buyIn,
      user.avatarUrl || "/images/icons/anonymous.svg",
      undefined,
      undefined,
      user.nameMasked,
      user.displayName,
      weeklyChamp
    );

    if (seatNumber !== null) {
      tableManager.setPlayerTable(socket.odId!, table.id);
      table.triggerMaybeStartHand();
    } else {
      // Seating failed - refund
      await cashOutPlayer(socket.odId!, buyIn);
      socket.emit('table:error', { message: 'No available seat' });
    }
  } catch (err) {
    console.error('Error joining table:', err);
    socket.emit('table:error', { message: 'Failed to join table' });
  }
}

export async function handleMatchmakingLeave(socket: AuthenticatedSocket, tableManager: TableManager): Promise<void> {
  try {
    const table = tableManager.getPlayerTable(socket.odId!);
    if (table) {
      await unseatAndCashOut(table, socket.odId!, tableManager);
    }
  } catch (err) {
    console.error(`Error during matchmaking:leave for ${socket.odId}:`, err);
    socket.emit('table:error', { message: 'Failed to leave table' });
  }
}


export function handleDebugSetChips(socket: AuthenticatedSocket, data: { chips: number }, tableManager: TableManager): void {
  const table = tableManager.getPlayerTable(socket.odId!);
  if (!table) {
    socket.emit('table:error', { message: '[debug] Not seated at a table' });
    return;
  }

  const success = table.debugSetChips(socket.odId!, data.chips);
  if (success) {
    console.log(`[debug] Set chips for ${socket.odId} to ${data.chips}`);
  } else {
    socket.emit('table:error', { message: '[debug] Failed to set chips' });
  }
}

// ========== Private table handlers ==========

export async function handlePrivateCreate(
  socket: AuthenticatedSocket,
  data: { blinds: string },
  tableManager: TableManager
): Promise<void> {
  if (maintenanceService.isMaintenanceActive()) {
    socket.emit('table:error', { message: 'メンテナンス中のため作成できません' });
    return;
  }

  if (!socket.odId) {
    socket.emit('table:error', { message: 'ログインが必要です' });
    return;
  }

  const MAX_PRIVATE_TABLES = 5;
  if (tableManager.getPrivateTableCount() >= MAX_PRIVATE_TABLES) {
    socket.emit('table:error', { message: `プライベートテーブルの上限（${MAX_PRIVATE_TABLES}）に達しています` });
    return;
  }

  const { blinds } = data;

  try {
    const parts = blinds.split('/');
    if (parts.length !== 2 || parts.some(p => isNaN(Number(p)) || Number(p) <= 0)) {
      socket.emit('table:error', { message: 'Invalid blinds format' });
      return;
    }
    const [, bb] = parts.map(Number);
    const buyIn = bb * 100;

    const user = await prisma.user.findUnique({
      where: { id: socket.odId },
      include: { bankroll: true },
    });

    if (!user?.bankroll || user.bankroll.balance < buyIn) {
      socket.emit('table:error', { message: 'Insufficient balance' });
      return;
    }

    // Leave current table if any
    const currentTable = tableManager.getPlayerTable(socket.odId);
    if (currentTable) {
      await unseatAndCashOut(currentTable, socket.odId, tableManager);
    }

    // Create private table
    const { table, inviteCode } = tableManager.createPrivateTable(blinds);

    // Deduct buy-in
    const deducted = await deductBuyIn(socket.odId, buyIn);
    if (!deducted) {
      tableManager.removeTable(table.id);
      socket.emit('table:error', { message: 'Insufficient balance' });
      return;
    }

    if (!socket.connected) {
      await cashOutPlayer(socket.odId, buyIn);
      tableManager.removeTable(table.id);
      return;
    }

    // Seat player
    const weeklyChamp = await hasWeeklyChampionBadge(socket.odId);
    const seatNumber = table.seatPlayer(
      socket.odId,
      user.username,
      socket,
      buyIn,
      user.avatarUrl || "/images/icons/anonymous.svg",
      undefined,
      undefined,
      user.nameMasked,
      user.displayName,
      weeklyChamp
    );

    if (seatNumber !== null) {
      tableManager.setPlayerTable(socket.odId, table.id);
      socket.emit('private:created', { tableId: table.id, inviteCode });
      console.log(`[Private] Table created: ${table.id} (code: ${inviteCode}) by ${socket.odId}`);
      // triggerMaybeStartHand は呼ばない（1人では開始しない）
    } else {
      await cashOutPlayer(socket.odId, buyIn);
      tableManager.removeTable(table.id);
      socket.emit('table:error', { message: 'Failed to create table' });
    }
  } catch (err) {
    console.error('Error creating private table:', err);
    socket.emit('table:error', { message: 'Failed to create table' });
  }
}

export async function handlePrivateJoin(
  socket: AuthenticatedSocket,
  data: { inviteCode: string },
  tableManager: TableManager
): Promise<void> {
  if (maintenanceService.isMaintenanceActive()) {
    socket.emit('table:error', { message: 'メンテナンス中のため参加できません' });
    return;
  }

  const { inviteCode } = data;
  const table = tableManager.getTableByInviteCode(inviteCode);

  if (!table) {
    socket.emit('table:error', { message: 'テーブルが見つかりません' });
    return;
  }

  if (!table.hasAvailableSeat()) {
    socket.emit('table:error', { message: 'テーブルが満席です' });
    return;
  }

  try {
    const [, bb] = table.blinds.split('/').map(Number);
    const buyIn = bb * 100;

    const user = await prisma.user.findUnique({
      where: { id: socket.odId },
      include: { bankroll: true },
    });

    if (!user?.bankroll || user.bankroll.balance < buyIn) {
      socket.emit('table:error', { message: 'Insufficient balance' });
      return;
    }

    // Leave current table if any
    const currentTable = tableManager.getPlayerTable(socket.odId!);
    if (currentTable) {
      await unseatAndCashOut(currentTable, socket.odId!, tableManager);
    }

    // Deduct buy-in
    const deducted = await deductBuyIn(socket.odId!, buyIn);
    if (!deducted) {
      socket.emit('table:error', { message: 'Insufficient balance' });
      return;
    }

    if (!socket.connected) {
      await cashOutPlayer(socket.odId!, buyIn);
      return;
    }

    // Seat player
    const weeklyChamp = await hasWeeklyChampionBadge(socket.odId!);
    const seatNumber = table.seatPlayer(
      socket.odId!,
      user.username,
      socket,
      buyIn,
      user.avatarUrl || "/images/icons/anonymous.svg",
      undefined,
      undefined,
      user.nameMasked,
      user.displayName,
      weeklyChamp
    );

    if (seatNumber !== null) {
      tableManager.setPlayerTable(socket.odId!, table.id);
      socket.emit('private:created', { tableId: table.id, inviteCode });
      table.triggerMaybeStartHand();
    } else {
      await cashOutPlayer(socket.odId!, buyIn);
      socket.emit('table:error', { message: 'No available seat' });
    }
  } catch (err) {
    console.error('Error joining private table:', err);
    socket.emit('table:error', { message: 'Failed to join table' });
  }
}
