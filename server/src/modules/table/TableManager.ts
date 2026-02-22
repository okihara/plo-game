import { Server } from 'socket.io';
import { TableInstance } from './TableInstance.js';

export class TableManager {
  private tables: Map<string, TableInstance> = new Map();
  private playerTables: Map<string, string> = new Map(); // odId -> tableId
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

  // Find a table with available seats (prefer table with fewest players for balance)
  public findAvailableTable(blinds: string, isFastFold: boolean = false, excludeTableId?: string): TableInstance | null {
    let best: TableInstance | null = null;
    let minPlayers = Infinity;

    for (const table of this.tables.values()) {
      if (
        table.blinds === blinds &&
        table.isFastFold === isFastFold &&
        table.hasAvailableSeat() &&
        table.id !== excludeTableId
      ) {
        const count = table.getPlayerCount();
        if (count < minPlayers) {
          minPlayers = count;
          best = table;
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
    if (!this.tables.has(tableId)) {
      console.warn(`[TableManager] removeTable: table ${tableId} not found`);
    }
    this.tables.delete(tableId);
  }

  // Get all tables info for lobby
  public getTablesInfo() {
    return Array.from(this.tables.values()).map(t => t.getTableInfo());
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

  // Clean up empty tables (except one for each blind level)
  public cleanupEmptyTables(): void {
    const tablesByBlinds: Map<string, TableInstance[]> = new Map();

    for (const table of this.tables.values()) {
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
