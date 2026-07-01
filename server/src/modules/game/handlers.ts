import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { TournamentManager } from '../tournament/TournamentManager.js';
import { prisma } from '../../config/database.js';
import { Action } from '../../shared/logic/types.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';
import { cashOutPlayer, deductBuyIn } from '../auth/bankroll.js';
import { AuthenticatedSocket } from './authMiddleware.js';
import { handleFastFoldMove, setupFastFoldCallback } from './fastFoldService.js';
import { hasWeeklyChampionBadge, hasSeasonTop3Badge } from '../badges/badgeService.js';

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
  // unseat 経路に乗ったら、もう grace 復帰の対象ではないのでタイマーを止める
  tableManager.clearDisconnectTimer(odId);
  const result = table.unseatPlayer(odId);
  tableManager.removePlayerFromTracking(odId);
  if (result) {
    await cashOutPlayer(result.odId, result.chips, table.id);
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

export function handleDisconnect(socket: AuthenticatedSocket, tableManager: TableManager): void {
  const odId = socket.odId;
  if (!odId) return;
  const table = tableManager.getPlayerTable(odId);
  if (!table) return;

  // 切断猶予: クライアントが auto-reconnect で復帰したら socket.ts 側で
  // clearDisconnectTimer + reconnectPlayer される。期限切れまで戻らなければ unseat。
  console.log(`[Disconnect] Starting grace period for ${odId} at table ${table.id}`);
  tableManager.scheduleDisconnectCleanup(odId, async () => {
    // タイマー満了時点で席が残っているなら片付ける
    const currentTable = tableManager.getPlayerTable(odId);
    if (!currentTable) return;
    console.log(`[Disconnect] Grace expired for ${odId}, cashing out from ${currentTable.id}`);
    await unseatAndCashOut(currentTable, odId, tableManager);
  });
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
  data: { tableId?: string },
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
  tableManager: TableManager,
  tournamentManager?: TournamentManager
): Promise<void> {
  // トーナメント着席中はリング戦に参加できない（1ユーザー1ソケットのため、両方に
  // 着席すると単一ソケットが両卓のルームに入り、状態混線・アクション誤ルーティングが起きる）。
  // バスト（eliminated）後はトーナメント卓から外れているのでリング戦に参加できる。
  if (tournamentManager?.isPlayerSeatedInTournament(socket.odId!)) {
    socket.emit('table:error', { message: 'トーナメント参加中はリング戦に参加できません' });
    return;
  }

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

    // 既に席があれば何もしない（再接続後の自動 matchmaking 再投与でも二重 buy-in にならないように）。
    // 別ステークスへの移動などで明示的にテーブルを変えたい場合は、UI 側で先に table:leave を投げる前提。
    const currentTable = tableManager.getPlayerTable(socket.odId!);
    if (currentTable) {
      console.log(`[matchmaking] Already seated at ${currentTable.id}, skipping rejoin for ${socket.odId}`);
      return;
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
    const [weeklyChamp, seasonTop3] = await Promise.all([
      hasWeeklyChampionBadge(socket.odId!),
      hasSeasonTop3Badge(socket.odId!),
    ]);
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
      weeklyChamp,
      seasonTop3
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
