// AFK検出: テーブルにタイムアウト・退席コールバックを設定

import { TableManager } from '../table/TableManager.js';
import { TableInstance } from '../table/TableInstance.js';
import { TABLE_CONSTANTS } from '../table/constants.js';
import { cashOutPlayer } from '../auth/bankroll.js';

export function setupAfkCallback(table: TableInstance, tableManager: TableManager): void {
  if (table.onPlayerTimedOut) return; // 設定済み
  table.onPlayerTimedOut = (odId: string) => {
    const count = tableManager.incrementTimeout(odId);
    return count >= TABLE_CONSTANTS.MAX_CONSECUTIVE_TIMEOUTS;
  };
  table.onAfkRemoval = (odId: string, chips: number) => {
    tableManager.removePlayerFromTracking(odId);
    cashOutPlayer(odId, chips, table.id).catch(e => console.error('[AFK] cashOut error:', e));
  };
}
