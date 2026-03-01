import { Server } from 'socket.io';
import { TableInstance } from './TableInstance.js';

export class TableManager {
  private tables: Map<string, TableInstance> = new Map();
  private playerTables: Map<string, string> = new Map(); // odId -> tableId
  private inviteCodeToTable: Map<string, string> = new Map(); // inviteCode -> tableId
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  // Create a new table
  public createTable(blinds: string = '1/3', isFastFold: boolean = false): TableInstance {
    const table = new TableInstance(this.io, blinds, isFastFold);
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
  public findAvailableTable(blinds: string, isFastFold: boolean = false, excludeTableId?: string): TableInstance | null {
    let best: TableInstance | null = null;
    let bestScore = isFastFold ? -1 : Infinity;

    for (const table of this.tables.values()) {
      if (
        table.blinds === blinds &&
        table.isFastFold === isFastFold &&
        !table.isPrivate &&
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
  public getOrCreateTable(blinds: string, isFastFold: boolean = false, excludeTableId?: string): TableInstance {
    const existing = this.findAvailableTable(blinds, isFastFold, excludeTableId);
    if (existing) return existing;
    return this.createTable(blinds, isFastFold);
  }

  // Remove a table
  public removeTable(tableId: string): void {
    const table = this.tables.get(tableId);
    if (!table) {
      console.warn(`[TableManager] removeTable: table ${tableId} not found`);
    } else if (table.inviteCode) {
      this.inviteCodeToTable.delete(table.inviteCode);
    }
    this.tables.delete(tableId);
  }

  // Get all tables info for lobby (excludes private tables)
  public getTablesInfo() {
    return Array.from(this.tables.values())
      .filter(t => !t.isPrivate)
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

  // ========== Private table methods ==========

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1を除外
    let code: string;
    do {
      code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this.inviteCodeToTable.has(code));
    return code;
  }

  public createPrivateTable(blinds: string): { table: TableInstance; inviteCode: string } {
    const inviteCode = this.generateInviteCode();
    const table = new TableInstance(this.io, blinds, false, { isPrivate: true, inviteCode });
    this.tables.set(table.id, table);
    this.inviteCodeToTable.set(inviteCode, table.id);
    return { table, inviteCode };
  }

  public getTableByInviteCode(inviteCode: string): TableInstance | undefined {
    const tableId = this.inviteCodeToTable.get(inviteCode.toUpperCase());
    if (!tableId) return undefined;
    return this.tables.get(tableId);
  }

  // Clean up empty tables (except one for each blind level)
  public cleanupEmptyTables(): void {
    const tablesByBlinds: Map<string, TableInstance[]> = new Map();

    for (const table of this.tables.values()) {
      // プライベートテーブルは空なら即削除
      if (table.isPrivate && table.getPlayerCount() === 0) {
        this.removeTable(table.id);
        continue;
      }

      const key = `${table.blinds}-${table.isFastFold}`;
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
