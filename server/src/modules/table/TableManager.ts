import { Server } from 'socket.io';
import { GameVariant, getVariantConfig } from '../../shared/logic/types.js';
import { TableInstance } from './TableInstance.js';
import { NullHandHistoryRecorder } from './helpers/HandHistoryRecorder.js';
import { TABLE_CONSTANTS } from './constants.js';

export class TableManager {
  private tables: Map<string, TableInstance> = new Map();
  private playerTables: Map<string, string> = new Map(); // odId -> tableId
  /** 切断猶予中のクリーンアップタイマー（odId -> Timer）。 */
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  // Create a new table
  public createTable(blinds: string = '1/3', isFastFold: boolean = false, variant: GameVariant = 'plo', isHorse: boolean = false): TableInstance {
    // ハンド履歴は omaha 系 variant (PLO / PLO5 / Bomb Pot) のみ保存。それ以外 (Stud/Razz/Draw/Holdem 等) は Null Recorder。
    const handHistoryEnabledVariants: GameVariant[] = ['plo', 'plo5', 'plo_double_board_bomb'];
    const historyRecorder = handHistoryEnabledVariants.includes(variant) ? undefined : new NullHandHistoryRecorder();
    const table = new TableInstance(this.io, blinds, isFastFold, { variant, historyRecorder, isHorse });
    this.tables.set(table.id, table);
    return table;
  }

  // Get a table by ID
  public getTable(tableId: string): TableInstance | undefined {
    return this.tables.get(tableId);
  }

  // Find a table with available seats
  // Fast-fold: prefer table with most players that hasn't started a hand yet
  // Normal: prefer table with fewest players for balance
  public findAvailableTable(blinds: string, isFastFold: boolean = false, excludeTableId?: string, variant: GameVariant = 'plo', isHorse: boolean = false): TableInstance | null {
    let best: TableInstance | null = null;
    let bestScore = isFastFold ? -1 : Infinity;

    for (const table of this.tables.values()) {
      if (
        table.blinds === blinds &&
        table.isFastFold === isFastFold &&
        table.isHorse === isHorse &&
        (isHorse || table.variant === variant) &&
        table.hasAvailableSeat() &&
        table.id !== excludeTableId
      ) {
        const count = table.getPlayerCount();

        if (isFastFold) {
          // ファストフォールド: ハンド未開始 & 着席人数が最も多いテーブル
          if (!table.isHandInProgress && count > bestScore) {
            bestScore = count;
            best = table;
          }
        } else {
          // 通常: 着席人数が最も少ないテーブル
          if (count < bestScore) {
            bestScore = count;
            best = table;
          }
        }
      }
    }
    return best;
  }

  // Get or create a table for given parameters
  // 通常テーブル（非FF）は同一条件で1つまで。満席ならnullを返す
  public getOrCreateTable(blinds: string, isFastFold: boolean = false, excludeTableId?: string, variant: GameVariant = 'plo', isHorse: boolean = false): TableInstance | null {
    const existing = this.findAvailableTable(blinds, isFastFold, excludeTableId, variant, isHorse);
    if (existing) return existing;

    // 通常テーブルは1つしか作らない（満席ならnull）
    if (!isFastFold) {
      const existingTable = this.findTableByCondition(blinds, false, variant, isHorse);
      if (existingTable) return null;
    }

    return this.createTable(blinds, isFastFold, variant, isHorse);
  }

  // 条件に合う既存テーブルを探す（空席の有無を問わない）
  private findTableByCondition(blinds: string, isFastFold: boolean, variant: GameVariant, isHorse: boolean): TableInstance | null {
    for (const table of this.tables.values()) {
      if (
        table.blinds === blinds &&
        table.isFastFold === isFastFold &&
        table.isHorse === isHorse &&
        (isHorse || table.variant === variant)
      ) {
        return table;
      }
    }
    return null;
  }

  // Remove a table
  public removeTable(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table) {
      console.warn(`[TableManager] removeTable: table ${tableId} not found`);
    } else {
      table.disconnectAllSpectators('テーブルが閉じられました');
    }
    this.tables.delete(tableId);
  }

  public getTablesInfo() {
    return Array.from(this.tables.values())
      .map(t => t.getTableInfo());
  }

  // Track player's current table
  public setPlayerTable(odId: string, tableId: string): void {
    this.playerTables.set(odId, tableId);
  }

  // Get player's current table
  public getPlayerTable(odId: string): TableInstance | undefined {
    const tableId = this.playerTables.get(odId);
    if (!tableId) return undefined;
    return this.tables.get(tableId);
  }

  // Remove player from tracking
  public removePlayerFromTracking(odId: string): void {
    this.playerTables.delete(odId);
  }

  /**
   * 切断猶予タイマーを開始する。期限内に再接続があれば clearDisconnectTimer を呼んでキャンセル。
   * 期限切れで onTimeout が実行され、典型的には unseatAndCashOut を呼ぶ。
   */
  public scheduleDisconnectCleanup(odId: string, onTimeout: () => void | Promise<void>): void {
    this.clearDisconnectTimer(odId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(odId);
      try {
        const result = onTimeout();
        if (result instanceof Promise) {
          result.catch((err) => console.error(`[TableManager] disconnect cleanup failed for ${odId}:`, err));
        }
      } catch (err) {
        console.error(`[TableManager] disconnect cleanup failed for ${odId}:`, err);
      }
    }, TABLE_CONSTANTS.DISCONNECT_GRACE_MS);
    this.disconnectTimers.set(odId, timer);
  }

  /** 切断猶予タイマーをキャンセル。タイマーが存在した場合は true。 */
  public clearDisconnectTimer(odId: string): boolean {
    const timer = this.disconnectTimers.get(odId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(odId);
      return true;
    }
    return false;
  }

  // Clean up empty tables (except one for each blind level)
  public cleanupEmptyTables(): void {
    const tablesByBlinds: Map<string, TableInstance[]> = new Map();

    for (const table of this.tables.values()) {
      const key = `${table.blinds}-${table.isFastFold}-${table.variant}-${table.isHorse}`;
      const tables = tablesByBlinds.get(key) || [];
      tables.push(table);
      tablesByBlinds.set(key, tables);
    }

    for (const [_, tables] of tablesByBlinds) {
      // Keep at least one table per blind level
      const emptyTables = tables.filter(t => t.getPlayerCount() === 0);
      for (let i = 1; i < emptyTables.length; i++) {
        this.removeTable(emptyTables[i].id);
      }
    }
  }
}
