import { Socket } from 'socket.io';
import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { prisma } from '../../config/database.js';
import { cashOutPlayer } from '../auth/bankroll.js';
import { AuthenticatedSocket } from './authMiddleware.js';
import { setupAfkCallback } from './afkService.js';

// FFテーブルにハンド完了後の再割り当てコールバックを設定
export function setupFastFoldCallback(table: TableInstance, tableManager: TableManager): void {
  if (!table.isFastFold || table.onFastFoldReassign) return;
  table.onFastFoldReassign = (players) => {
    for (const p of players) {
      tableManager.removePlayerFromTracking(p.odId);

      if (p.chips <= 0) {
        cashOutPlayer(p.odId, 0, table.id).catch(e => console.error('[FastFold] cashOut error:', e));
        p.socket.emit('table:busted', { message: 'チップがなくなりました' });
        continue;
      }

      // ソケットが切断済みならゴーストプレイヤーを防ぐ
      if (!p.socket.connected) {
        console.warn(`[FastFold] Skipping reassign for disconnected player ${p.odId}`);
        cashOutPlayer(p.odId, p.chips, table.id).catch(e => console.error('[FastFold] cashOut error:', e));
        continue;
      }

      const newTable = tableManager.getOrCreateTable(table.blinds, true, table.id);
      setupFastFoldCallback(newTable, tableManager);
      setupAfkCallback(newTable, tableManager);

      const seatNumber = newTable.seatPlayer(
        p.odId, p.odName, p.socket, p.chips, p.avatarUrl, undefined,
        { skipJoinedEmit: true },
        p.nameMasked,
        p.displayName
      );

      if (seatNumber !== null) {
        tableManager.setPlayerTable(p.odId, newTable.id);
        p.socket.emit('table:change', { tableId: newTable.id, seat: seatNumber });
        newTable.triggerMaybeStartHand();
      } else {
        cashOutPlayer(p.odId, p.chips, table.id).catch(e => console.error('[FastFold] cashOut error:', e));
        p.socket.emit('table:left');
      }
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

  // 2. トラッキングを一旦削除
  tableManager.removePlayerFromTracking(odId);

  // 3. 新しいファストフォールドテーブルを取得（現テーブルを除外優先）
  const newTable = tableManager.getOrCreateTable(
    currentTable.blinds,
    true,
    currentTable.id
  );
  setupFastFoldCallback(newTable, tableManager);
  setupAfkCallback(newTable, tableManager);

  // 4. ユーザー情報を取得
  const user = await prisma.user.findUnique({
    where: { id: odId },
  });

  if (!user) {
    console.error(`[FastFold] User not found: ${odId}`);
    await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
    socket.emit('table:left');
    return;
  }

  // await中にソケットが切断された場合はゴーストプレイヤーを防ぐ
  if (!socket.connected) {
    console.warn(`[FastFold] Socket disconnected during move for ${odId}, cashing out`);
    await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
    return;
  }

  // 5. 新テーブルに着席（バイイン控除なし、チップをそのまま持ち越し）
  const seatNumber = newTable.seatPlayer(
    odId,
    user.username,
    socket as Socket,
    unseatResult.chips,
    user.avatarUrl,
    undefined,
    { skipJoinedEmit: true },
    user.nameMasked,
    user.displayName
  );

  if (seatNumber !== null) {
    // 6. トラッキング更新
    tableManager.setPlayerTable(odId, newTable.id);

    // 7. table:change を送信（フロントエンドはこれでテーブル移動を認識）
    socket.emit('table:change', { tableId: newTable.id, seat: seatNumber });

    // 8. 新テーブルのハンド開始を試行
    newTable.triggerMaybeStartHand();
  } else {
    // 席がない場合はチップを返金してテーブル離脱扱い
    await cashOutPlayer(odId, unseatResult.chips, currentTable.id);
    socket.emit('table:left');
    console.error(`[FastFold] Failed to seat player ${odId} at new table ${newTable.id}`);
  }
}
