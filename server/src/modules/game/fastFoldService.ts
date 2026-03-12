import { Socket } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { prisma } from '../../config/database.js';
import { cashOutPlayer } from '../auth/bankroll.js';
import { AuthenticatedSocket } from './authMiddleware.js';

// プレイヤーを新しいFFテーブルへ移動する共通処理
function movePlayerToNewTable(params: {
  odId: string;
  odName: string;
  displayName?: string | null;
  socket: Socket;
  chips: number;
  avatarUrl: string | null;
  nameMasked: boolean;
  sourceTable: TableInstance;
  tableManager: TableManager;
}): void {
  const { odId, odName, displayName, socket, chips, avatarUrl, nameMasked, sourceTable, tableManager } = params;

  tableManager.removePlayerFromTracking(odId);

  if (chips <= 0) {
    cashOutPlayer(odId, 0, sourceTable.id).catch(e => console.error('[FastFold] cashOut error:', e));
    socket.emit('table:busted', { message: 'チップがなくなりました' });
    return;
  }

  if (!socket.connected) {
    console.warn(`[FastFold] Skipping reassign for disconnected player ${odId}`);
    cashOutPlayer(odId, chips, sourceTable.id).catch(e => console.error('[FastFold] cashOut error:', e));
    return;
  }

  const newTable = tableManager.getOrCreateTable(sourceTable.blinds, true, sourceTable.id);
  if (!newTable) {
    cashOutPlayer(odId, chips, sourceTable.id).catch(e => console.error('[FastFold] cashOut error:', e));
    socket.emit('table:left');
    return;
  }
  setupFastFoldCallback(newTable, tableManager);

  const seatNumber = newTable.seatPlayer(
    odId, odName, socket, chips, avatarUrl, undefined,
    { skipJoinedEmit: true },
    nameMasked,
    displayName
  );

  if (seatNumber !== null) {
    tableManager.setPlayerTable(odId, newTable.id);
    socket.emit('table:change', { tableId: newTable.id, seat: seatNumber });
    newTable.triggerMaybeStartHand();
  } else {
    cashOutPlayer(odId, chips, sourceTable.id).catch(e => console.error('[FastFold] cashOut error:', e));
    socket.emit('table:left');
  }
}

// FFテーブルにハンド完了後の再割り当てコールバックを設定
export function setupFastFoldCallback(table: TableInstance, tableManager: TableManager): void {
  if (!table.isFastFold || table.onFastFoldReassign) return;
  // タイムアウトフォールド時もテーブル移動
  if (!table.onTimeoutFold) {
    table.onTimeoutFold = async (odId: string, socket: Socket) => {
      await handleFastFoldMove(socket as AuthenticatedSocket, table, odId, tableManager);
    };
  }

  table.onFastFoldReassign = (players) => {
    for (const p of players) {
      movePlayerToNewTable({
        odId: p.odId,
        odName: p.odName,
        displayName: p.displayName,
        socket: p.socket,
        chips: p.chips,
        avatarUrl: p.avatarUrl,
        nameMasked: p.nameMasked,
        sourceTable: table,
        tableManager,
      });
    }
  };
}

// ファストフォールド: フォールド後に別テーブルへ移動する
export async function handleFastFoldMove(
  socket: AuthenticatedSocket,
  currentTable: TableInstance,
  odId: string,
  tableManager: TableManager
): Promise<void> {
  // 1. 現テーブルから静かに離席（チップを持って出る）
  const unseatResult = currentTable.unseatForFastFold(odId);
  if (!unseatResult) {
    console.warn(`[FastFold] unseatForFastFold failed for ${odId}`);
    return;
  }

  // チップが0以下なら移動せずバスト扱い
  if (unseatResult.chips <= 0) {
    tableManager.removePlayerFromTracking(odId);
    await cashOutPlayer(odId, 0, currentTable.id);
    socket.emit('table:busted', { message: 'チップがなくなりました' });
    return;
  }

  // 2. ユーザー情報を取得
  const user = await prisma.user.findUnique({
    where: { id: odId },
  });

  if (!user) {
    console.error(`[FastFold] User not found: ${odId}`);
    tableManager.removePlayerFromTracking(odId);
    await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
    socket.emit('table:left');
    return;
  }

  // 3. 新テーブルへ移動
  movePlayerToNewTable({
    odId,
    odName: user.username,
    displayName: user.displayName,
    socket: socket as Socket,
    chips: unseatResult.chips,
    avatarUrl: user.avatarUrl,
    nameMasked: user.nameMasked,
    sourceTable: currentTable,
    tableManager,
  });
}
