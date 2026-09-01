import { Server } from 'socket.io';
import { GameVariant, getVariantConfig } from '../../shared/logic/types.js';
import { TableInstance } from './TableInstance.js';
import { NullHandHistoryRecorder } from './helpers/HandHistoryRecorder.js';
import { TableLifecycleCallbacks } from './types.js';
import { TABLE_CONSTANTS } from './constants.js';

export class TableManager {
  private tables: Map<string, TableInstance> = new Map();
  private playerTables: Map<string, string> = new Map(); // odId -> tableId
  private inviteCodeToTable: Map<string, string> = new Map(); // inviteCode -> tableId
  /** 切断猶予中のクリーンアップタイマー（odId -> Timer）。 */
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** 無人になったプライベート卓の削除待ちタイマー（tableId -> Timer）。 */
  private emptyPrivateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  /**
   * キャッシュゲームのバスト処理: 通知・離席に加えて playerTables の紐付きも解除する。
   * 解除しないと matchmaking:join が「着席済み」と誤判定し、再参加できなくなる。
   * @param onBustsProcessed バスト処理ループ完了後の追加処理（プライベート卓の寿命再評価など）
   */
  private createCashLifecycleCallbacks(onBustsProcessed?: () => void): TableLifecycleCallbacks {
    return {
      onPlayerBusted: (odId, _seatIndex, socket) => {
        socket?.emit('table:busted', { message: 'チップがなくなりました' });
        this.removePlayerFromTracking(odId);
        return true; // TableInstanceがunseatPlayerを呼ぶ
      },
      ...(onBustsProcessed ? { onBustsProcessed } : {}),
    };
  }

  // Create a new table
  public createTable(blinds: string = '1/3', isFastFold: boolean = false, variant: GameVariant = 'plo', isHorse: boolean = false): TableInstance {
    // ハンド履歴は omaha 系 variant (PLO / PLO5 / Bomb Pot) のみ保存。それ以外 (Stud/Razz/Draw/Holdem 等) は Null Recorder。
    const handHistoryEnabledVariants: GameVariant[] = ['plo', 'plo5', 'plo_double_board_bomb'];
    const historyRecorder = handHistoryEnabledVariants.includes(variant) ? undefined : new NullHandHistoryRecorder();
    const table = new TableInstance(this.io, blinds, isFastFold, {
      variant,
      historyRecorder,
      isHorse,
      lifecycleCallbacks: this.createCashLifecycleCallbacks(),
    });
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
        (isHorse || table.variant === variant) &&
        !table.isPrivate
      ) {
        return table;
      }
    }
    return null;
  }

  // Remove a table
  public removeTable(tableId: string): void {
    this.cancelPrivateTableCleanup(tableId);
    const table = this.tables.get(tableId);
    if (!table) {
      console.warn(`[TableManager] removeTable: table ${tableId} not found`);
    } else {
      table.disconnectAllSpectators('テーブルが閉じられました');
      table.dispose();
      if (table.inviteCode) {
        this.inviteCodeToTable.delete(table.inviteCode);
      }
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

  // ========== Private table methods ==========

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1を除外
    let code: string;
    do {
      code = Array.from({ length: 5 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while (this.inviteCodeToTable.has(code));
    return code;
  }

  public getPrivateTableCount(): number {
    return this.getPrivateTables().length;
  }

  public getPrivateTables(): TableInstance[] {
    return Array.from(this.tables.values()).filter(t => t.isPrivate);
  }

  /** @param ownerOdId 作成者。コーチング用ポーズを操作できる唯一のプレイヤー */
  public createPrivateTable(blinds: string, ownerOdId: string): { table: TableInstance; inviteCode: string } {
    const inviteCode = this.generateInviteCode();
    // バストで全員いなくなるケースは unseatAndCashOut を通らないため、
    // バスト処理の完了時点でも寿命を評価する
    let created: TableInstance | null = null;
    const table = new TableInstance(this.io, blinds, false, {
      isPrivate: true,
      inviteCode,
      ownerOdId,
      lifecycleCallbacks: this.createCashLifecycleCallbacks(() => {
        if (created) this.syncPrivateTableLifetime(created);
      }),
    });
    created = table;
    this.tables.set(table.id, table);
    this.inviteCodeToTable.set(inviteCode, table.id);
    return { table, inviteCode };
  }

  public getTableByInviteCode(inviteCode: string): TableInstance | undefined {
    const tableId = this.inviteCodeToTable.get(inviteCode.toUpperCase());
    if (!tableId) return undefined;
    return this.tables.get(tableId);
  }

  /**
   * プライベート卓の寿命を現在の在席状況に合わせて更新する。
   * 無人なら PRIVATE_EMPTY_TTL_MS 後の削除を予約し、誰かが座っていれば予約を取り消す。
   * 着席・離席のどちらの後に呼んでも良い（冪等）。
   */
  public syncPrivateTableLifetime(table: TableInstance): void {
    if (!table.isPrivate) return;

    if (table.getPlayerCount() > 0) {
      this.cancelPrivateTableCleanup(table.id);
      return;
    }
    if (this.emptyPrivateTimers.has(table.id)) return;

    const timer = setTimeout(() => {
      this.emptyPrivateTimers.delete(table.id);
      const current = this.tables.get(table.id);
      if (!current || current.getPlayerCount() > 0) return;
      console.log(`[Private] Table ${current.id} (code: ${current.inviteCode}) removed (empty for TTL)`);
      this.removeTable(current.id);
    }, TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS);

    this.emptyPrivateTimers.set(table.id, timer);
    console.log(
      `[Private] Table ${table.id} (code: ${table.inviteCode}) is empty, closing in ${TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS}ms`
    );
  }

  /** 空室削除の予約を取り消す。予約が存在した場合は true。 */
  private cancelPrivateTableCleanup(tableId: string): boolean {
    const timer = this.emptyPrivateTimers.get(tableId);
    if (!timer) return false;
    clearTimeout(timer);
    this.emptyPrivateTimers.delete(tableId);
    return true;
  }
}
