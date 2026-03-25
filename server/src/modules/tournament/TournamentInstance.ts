import { Server, Socket } from 'socket.io';
import { TableInstance } from '../table/TableInstance.js';
import { TableLifecycleCallbacks } from '../table/types.js';
import { BlindScheduler } from './BlindScheduler.js';
import { PrizeCalculator, PrizeEntry } from './PrizeCalculator.js';
import { TableBalancer } from './TableBalancer.js';
import {
  TournamentConfig,
  TournamentPlayer,
  TournamentStatus,
  ClientTournamentState,
  BlindLevel,
  PendingMove,
  TournamentResult,
} from './types.js';
import { maskName } from '../../shared/utils.js';
import { PLAYERS_PER_TABLE, TOURNAMENT_DISCONNECT_GRACE_MS } from './constants.js';

/**
 * 1つのトーナメントのライフサイクルを管理する
 * 内部に複数の TableInstance を保持し、コールバックで連携する
 */
export class TournamentInstance {
  public readonly id: string;
  public readonly config: TournamentConfig;
  private status: TournamentStatus = 'registering';
  private players: Map<string, TournamentPlayer> = new Map();
  private tables: Map<string, TableInstance> = new Map();
  private tablePlayerMap: Map<string, Set<string>> = new Map(); // tableId → Set<odId>
  private blindScheduler: BlindScheduler;
  private prizePool: number = 0;
  private prizes: PrizeEntry[] = [];
  private pendingMoves: PendingMove[] = [];
  private pendingBusts: { odId: string; socket: Socket | null; chipsAtHandStart: number }[] = [];
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly io: Server;
  private readonly roomName: string;

  // 外部通知用コールバック（結果データ付き）
  public onTournamentComplete?: (tournamentId: string, results: TournamentResult[]) => void;

  constructor(io: Server, config: TournamentConfig) {
    this.io = io;
    this.id = config.id;
    this.config = config;
    this.roomName = `tournament:${this.id}`;
    this.blindScheduler = new BlindScheduler(config.blindSchedule);
  }

  // ============================================
  // Public Getters
  // ============================================

  public getStatus(): TournamentStatus {
    return this.status;
  }

  public getPlayerCount(): number {
    return this.players.size;
  }

  public getPlayersRemaining(): number {
    let count = 0;
    for (const p of this.players.values()) {
      if (p.status === 'playing' || p.status === 'disconnected') count++;
    }
    return count;
  }

  public getTable(tableId: string): TableInstance | undefined {
    return this.tables.get(tableId);
  }

  public getTableCount(): number {
    return this.tables.size;
  }

  /** 全テーブルをイテレート（管理ダッシュボード用） */
  public getTables(): IterableIterator<TableInstance> {
    return this.tables.values();
  }

  public getPlayer(odId: string): TournamentPlayer | undefined {
    return this.players.get(odId);
  }

  public getPrizePool(): number {
    return this.prizePool;
  }

  // ============================================
  // Registration
  // ============================================

  /**
   * トーナメントに参加登録
   */
  public registerPlayer(
    odId: string,
    odName: string,
    socket: Socket,
    options?: {
      displayName?: string | null;
      avatarId?: number;
      avatarUrl?: string | null;
      nameMasked?: boolean;
    }
  ): { success: boolean; error?: string } {
    if (this.status !== 'registering' && !this.isLateRegistrationOpen()) {
      return { success: false, error: 'トーナメントの登録受付は終了しています' };
    }

    if (this.players.size >= this.config.maxPlayers) {
      return { success: false, error: '定員に達しています' };
    }

    if (this.players.has(odId)) {
      return { success: false, error: '既に登録済みです' };
    }

    const player: TournamentPlayer = {
      odId,
      odName,
      displayName: options?.displayName ?? null,
      avatarId: options?.avatarId ?? Math.floor(Math.random() * 10),
      avatarUrl: options?.avatarUrl ?? null,
      socket,
      chips: this.config.startingChips,
      tableId: null,
      seatIndex: null,
      status: 'registered',
      finishPosition: null,
      reentryCount: 0,
      registeredAt: new Date(),
      eliminatedAt: null,
      nameMasked: options?.nameMasked ?? true,
    };

    this.players.set(odId, player);
    this.prizePool += this.config.buyIn;

    // トーナメントルームに参加
    socket.join(this.roomName);

    // 登録通知
    this.broadcastTournamentState();

    return { success: true };
  }

  /**
   * 登録解除
   */
  public unregisterPlayer(odId: string): { success: boolean; error?: string } {
    if (this.status !== 'registering') {
      return { success: false, error: 'トーナメント開始後は登録解除できません' };
    }

    const player = this.players.get(odId);
    if (!player) {
      return { success: false, error: '登録されていません' };
    }

    player.socket?.leave(this.roomName);
    this.players.delete(odId);
    this.prizePool -= this.config.buyIn;

    this.broadcastTournamentState();
    return { success: true };
  }

  /**
   * リエントリー
   */
  public reenterPlayer(odId: string, socket: Socket): { success: boolean; error?: string } {
    if (!this.config.allowReentry) {
      return { success: false, error: 'リエントリー不可のトーナメントです' };
    }

    const player = this.players.get(odId);
    if (!player) {
      return { success: false, error: 'トーナメントに参加していません' };
    }

    if (player.status !== 'eliminated') {
      return { success: false, error: 'プレイ中のためリエントリーできません' };
    }

    if (player.reentryCount >= this.config.maxReentries) {
      return { success: false, error: 'リエントリー上限に達しています' };
    }

    const currentLevel = this.blindScheduler.getCurrentLevelIndex() + 1;
    if (currentLevel > this.config.reentryDeadlineLevel) {
      return { success: false, error: 'リエントリー期限を過ぎています' };
    }

    player.reentryCount++;
    player.chips = this.config.startingChips;
    player.status = 'playing';
    player.socket = socket;
    player.finishPosition = null;
    player.eliminatedAt = null;
    this.prizePool += this.config.buyIn;

    socket.join(this.roomName);

    // 空きのあるテーブルに着席
    this.seatPlayerAtAvailableTable(player);

    this.broadcastTournamentState();
    return { success: true };
  }

  // ============================================
  // Tournament Lifecycle
  // ============================================

  /**
   * トーナメント開始
   */
  public start(): { success: boolean; error?: string } {
    if (this.status !== 'registering') {
      return { success: false, error: 'トーナメントは既に開始しています' };
    }

    const registeredPlayers = Array.from(this.players.values()).filter(
      p => p.status === 'registered'
    );

    if (registeredPlayers.length < this.config.minPlayers) {
      return { success: false, error: `最低${this.config.minPlayers}人必要です（現在${registeredPlayers.length}人）` };
    }

    this.status = 'starting';

    // 賞金構造を計算
    this.prizes = PrizeCalculator.calculate(
      registeredPlayers.length,
      this.prizePool,
      this.config.payoutPercentage
    );

    // テーブル割り当て
    const playerIds = registeredPlayers.map(p => p.odId);
    const tableAssignments = TableBalancer.initialAssignment(playerIds, this.config.playersPerTable);

    // 各テーブルを作成してプレイヤーを着席
    for (const assignedPlayers of tableAssignments) {
      const table = this.createTournamentTable();

      for (const odId of assignedPlayers) {
        const player = this.players.get(odId)!;
        player.status = 'playing';

        const seatIndex = this.seatPlayerAtTable(player, table, player.chips, { skipJoinedEmit: false });
        if (seatIndex === null) {
          // 着席失敗: ステータスをロールバック
          player.status = 'registered';
          console.error(`[Tournament ${this.id}] Failed to seat ${odId} during start`);
        }
      }
    }

    // ブラインドスケジュール開始
    this.blindScheduler.start((newLevel, nextLevel) => {
      this.onBlindLevelUp(newLevel, nextLevel);
    });

    this.status = 'running';

    // 各テーブルでハンド開始
    for (const table of this.tables.values()) {
      table.triggerMaybeStartHand();
    }

    this.broadcastTournamentState();
    return { success: true };
  }

  /**
   * トーナメントをキャンセル
   */
  public cancel(): void {
    this.status = 'cancelled';
    this.blindScheduler.stop();

    this.cleanupTablesAndTimers();

    this.io.to(this.roomName).emit('tournament:cancelled', { tournamentId: this.id });
    this.broadcastTournamentState();
  }

  // ============================================
  // Player Events
  // ============================================

  /**
   * プレイヤーの切断を処理
   */
  public handleDisconnect(odId: string): void {
    const player = this.players.get(odId);
    if (!player || player.status !== 'playing') return;

    player.status = 'disconnected';
    player.socket = null;

    // 猶予タイマー設定（2分）
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(odId);
      // 復帰しなかった場合: アクションタイムアウトで自動フォールドされ、
      // チップがなくなったらバスト処理される
      console.log(`[Tournament ${this.id}] Player ${odId} disconnect grace period expired`);
    }, TOURNAMENT_DISCONNECT_GRACE_MS);

    this.disconnectTimers.set(odId, timer);
  }

  /**
   * プレイヤーの再接続を処理
   */
  public handleReconnect(odId: string, socket: Socket): boolean {
    const player = this.players.get(odId);
    if (!player) return false;

    // eliminated は再接続不可
    if (player.status === 'eliminated') return false;

    // ソケット更新
    player.socket = socket;

    // 切断タイマーをクリア
    const timer = this.disconnectTimers.get(odId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(odId);
    }

    // disconnected → playing に復帰（registered はそのまま）
    if (player.status === 'disconnected') {
      player.status = 'playing';
    }

    // トーナメントルームに再参加
    socket.join(this.roomName);

    // テーブルに再接続
    if (player.tableId) {
      const table = this.tables.get(player.tableId);
      if (table) {
        table.reconnectPlayer(odId, socket);
      }
    }

    // トーナメント状態を送信
    socket.emit('tournament:state', this.getClientState(odId));

    return true;
  }

  // ============================================
  // Late Registration
  // ============================================

  public isLateRegistrationOpen(): boolean {
    if (this.status !== 'running') return false;
    const currentLevel = this.blindScheduler.getCurrentLevelIndex() + 1;
    return currentLevel <= this.config.lateRegistrationLevels;
  }

  /**
   * 遅刻登録（トーナメント開始後の参加）
   */
  public lateRegister(
    odId: string,
    odName: string,
    socket: Socket,
    options?: {
      displayName?: string | null;
      avatarId?: number;
      avatarUrl?: string | null;
      nameMasked?: boolean;
    }
  ): { success: boolean; error?: string } {
    if (!this.isLateRegistrationOpen()) {
      return { success: false, error: '遅刻登録期間は終了しています' };
    }

    // まず通常の登録処理
    const result = this.registerPlayer(odId, odName, socket, options);
    if (!result.success) return result;

    const player = this.players.get(odId)!;
    player.status = 'playing';

    // 賞金プール更新（registerPlayerで加算済み）
    this.prizes = PrizeCalculator.calculate(
      this.getTotalEntries(),
      this.prizePool,
      this.config.payoutPercentage
    );

    // 空きのあるテーブルに着席
    this.seatPlayerAtAvailableTable(player);

    this.broadcastTournamentState();
    return { success: true };
  }

  // ============================================
  // Client State
  // ============================================

  public getClientState(forOdId?: string): ClientTournamentState {
    const currentLevel = this.blindScheduler.getCurrentLevel();
    const nextLevel = this.blindScheduler.getNextLevel();
    const remaining = this.getPlayersRemaining();

    // スタック情報を計算
    const stacks = Array.from(this.players.values())
      .filter(p => p.status === 'playing' || p.status === 'disconnected')
      .map(p => p.chips);

    const averageStack = stacks.length > 0 ? Math.round(stacks.reduce((a, b) => a + b, 0) / stacks.length) : 0;
    const largestStack = stacks.length > 0 ? Math.max(...stacks) : 0;
    const smallestStack = stacks.length > 0 ? Math.min(...stacks) : 0;

    const myPlayer = forOdId ? this.players.get(forOdId) : undefined;

    return {
      tournamentId: this.id,
      name: this.config.name,
      status: this.status,
      buyIn: this.config.buyIn,
      startingChips: this.config.startingChips,
      prizePool: this.prizePool,
      totalPlayers: this.getTotalEntries(),
      playersRemaining: remaining,
      currentBlindLevel: currentLevel,
      nextBlindLevel: nextLevel,
      nextLevelAt: this.blindScheduler.getNextLevelAt(),
      myChips: myPlayer?.chips ?? null,
      myTableId: myPlayer?.tableId ?? null,
      averageStack,
      largestStack,
      smallestStack,
      payoutStructure: this.prizes.map(p => ({ position: p.position, amount: p.amount })),
      isLateRegistrationOpen: this.isLateRegistrationOpen(),
      isFinalTable: this.status === 'final_table' || (this.tables.size === 1 && remaining <= PLAYERS_PER_TABLE),
    };
  }

  public getLobbyInfo() {
    return {
      id: this.id,
      name: this.config.name,
      status: this.status,
      buyIn: this.config.buyIn,
      startingChips: this.config.startingChips,
      registeredPlayers: this.players.size,
      maxPlayers: this.config.maxPlayers,
      currentBlindLevel: this.blindScheduler.getCurrentLevel().level,
      prizePool: this.prizePool,
      scheduledStartTime: this.config.scheduledStartTime?.toISOString(),
      isLateRegistrationOpen: this.isLateRegistrationOpen(),
    };
  }

  // ============================================
  // Private: Table Management
  // ============================================

  private createTournamentTable(): TableInstance {
    const currentLevel = this.blindScheduler.getCurrentLevel();
    const blindsStr = `${currentLevel.smallBlind}/${currentLevel.bigBlind}`;

    const callbacks: TableLifecycleCallbacks = {
      onPlayerBusted: (odId, seatIndex, socket) => {
        this.onPlayerBusted(odId, seatIndex, socket);
        return true; // TableInstanceにunseatを任せる
      },
      onHandSettled: (seatChips) => {
        this.onHandSettled(seatChips);
      },
      onBustsProcessed: () => {
        if (this.pendingBusts.length > 0) {
          this.finalizeBustedPlayers();
        }
      },
    };

    const table = new TableInstance(this.io, blindsStr, false, {
      gameMode: 'tournament',
      lifecycleCallbacks: callbacks,
    });

    this.tables.set(table.id, table);
    this.tablePlayerMap.set(table.id, new Set());

    return table;
  }

  /**
   * プレイヤーをテーブルに着席させる共通ヘルパー。
   * 成功時は tableId/seatIndex/tracking を更新し seatIndex を返す。
   * 失敗時は null を返し、player の状態は変更しない。
   */
  private seatPlayerAtTable(
    player: TournamentPlayer,
    table: TableInstance,
    chips: number,
    options?: { skipJoinedEmit?: boolean }
  ): number | null {
    if (!player.socket) {
      console.warn(`[Tournament ${this.id}] Cannot seat player ${player.odId}: no socket`);
      return null;
    }

    const seatIndex = table.seatPlayer(
      player.odId,
      player.odName,
      player.socket,
      chips,
      player.avatarUrl,
      undefined,
      options,
      player.nameMasked,
      player.displayName
    );

    if (seatIndex === null) {
      console.warn(`[Tournament ${this.id}] Failed to seat player ${player.odId} at table ${table.id}`);
      return null;
    }

    player.tableId = table.id;
    player.seatIndex = seatIndex;
    player.chips = chips;
    this.trackPlayerAtTable(player.odId, table.id);
    return seatIndex;
  }

  private trackPlayerAtTable(odId: string, tableId: string): void {
    this.tablePlayerMap.get(tableId)?.add(odId);
  }

  private untrackPlayerFromTable(odId: string, tableId: string): void {
    this.tablePlayerMap.get(tableId)?.delete(odId);
  }

  private getTablePlayerIds(tableId: string): string[] {
    return Array.from(this.tablePlayerMap.get(tableId) ?? []);
  }

  private seatPlayerAtAvailableTable(player: TournamentPlayer): void {
    // 空きのあるテーブルを探す（人数が少ないテーブル優先）
    let bestTable: TableInstance | null = null;
    let minPlayers = Infinity;

    for (const table of this.tables.values()) {
      if (table.hasAvailableSeat()) {
        const count = table.getPlayerCount();
        if (count < minPlayers) {
          minPlayers = count;
          bestTable = table;
        }
      }
    }

    // 空きテーブルがなければ新規作成
    if (!bestTable) {
      bestTable = this.createTournamentTable();
    }

    const seatIndex = this.seatPlayerAtTable(player, bestTable, player.chips);

    if (seatIndex !== null) {
      player.socket?.emit('tournament:table_assigned', {
        tableId: bestTable.id,
        tournamentId: this.id,
      });

      // テーブルにプレイヤーが揃ったらハンド開始
      bestTable.triggerMaybeStartHand();
    }
  }

  // ============================================
  // Private: Callbacks from TableInstance
  // ============================================

  /**
   * TableInstance からのバスト通知。
   * ハンド中に複数人がバストする可能性があるため、ここでは蓄積のみ。
   * 実際の順位確定・フェーズ遷移は onHandSettled で一括処理する。
   */
  private onPlayerBusted(odId: string, _seatIndex: number, socket: Socket | null): void {
    const player = this.players.get(odId);
    if (!player) return;

    // ハンド開始時のチップ（同時バストの順位決定に使用）
    const chipsAtHandStart = player.chips;

    // ステータスを即座に eliminated に変更（getPlayersRemaining に反映）
    player.status = 'eliminated';
    player.chips = 0;
    player.eliminatedAt = new Date();

    // テーブルトラッキングから削除
    for (const [tableId, playerSet] of this.tablePlayerMap) {
      if (playerSet.has(odId)) {
        this.untrackPlayerFromTable(odId, tableId);
        break;
      }
    }
    player.tableId = null;
    player.seatIndex = null;

    // バスト情報を蓄積（onHandSettled で一括順位計算）
    this.pendingBusts.push({ odId, socket, chipsAtHandStart });
  }

  /**
   * ハンド完了時: チップ同期 → バストプレイヤーの順位一括確定 → フェーズ遷移
   */
  private onHandSettled(seatChips: { odId: string; seatIndex: number; chips: number }[]): void {
    // トーナメントプレイヤーのチップを同期
    for (const { odId, chips } of seatChips) {
      const player = this.players.get(odId);
      if (player) {
        player.chips = chips;
      }
    }

    // バストプレイヤーの順位を一括確定
    if (this.pendingBusts.length > 0) {
      this.finalizeBustedPlayers();
    }

    // ペンディングのファイナルテーブル形成
    if (this.pendingFinalTable) {
      this.scheduleFormFinalTable();
    }

    // ペンディング移動の実行
    this.executePendingMoves();
  }

  /**
   * 蓄積されたバストプレイヤーの順位を一括確定する。
   * 同一ハンドでバストした場合、ハンド開始時チップの多い方が上位。
   */
  private finalizeBustedPlayers(): void {
    const busts = [...this.pendingBusts];
    this.pendingBusts = [];

    if (busts.length === 0) return;

    const remaining = this.getPlayersRemaining();

    // 同時バストはチップ降順ソート（チップが多い方が上位 = 小さいposition）
    busts.sort((a, b) => b.chipsAtHandStart - a.chipsAtHandStart);

    // 全員同じ順位ベース: remaining + 1
    // 例: 4人残り中2人バスト → 順位は 3位(チップ多), 4位(チップ少)
    // ただしチップ同額なら同順位
    for (let i = 0; i < busts.length; i++) {
      const bust = busts[i];
      const player = this.players.get(bust.odId);
      if (!player) continue;

      // 同チップの前のプレイヤーと同順位にする
      if (i > 0 && bust.chipsAtHandStart === busts[i - 1].chipsAtHandStart) {
        const prevPlayer = this.players.get(busts[i - 1].odId);
        player.finishPosition = prevPlayer?.finishPosition ?? remaining + 1 + i;
      } else {
        player.finishPosition = remaining + 1 + i;
      }

      // 賞金チェック（既に計算済みの this.prizes を参照）
      const prize = this.getPrizeForPosition(player.finishPosition);

      // 個人通知
      bust.socket?.emit('tournament:eliminated', {
        position: player.finishPosition,
        totalPlayers: this.getTotalEntries(),
        prizeAmount: prize,
      });

      // 全体通知
      const eliminatedDisplayName = player.displayName
        ?? (player.nameMasked ? maskName(player.odName) : player.odName);

      this.io.to(this.roomName).emit('tournament:player_eliminated', {
        odId: bust.odId,
        odName: player.odName,
        displayName: eliminatedDisplayName,
        position: player.finishPosition,
        playersRemaining: remaining,
      });

      console.log(`[Tournament ${this.id}] Player ${bust.odId} eliminated at position ${player.finishPosition}, ${remaining} remaining`);
    }

    // 脱落によるプレイヤー数変動を即座に反映
    this.broadcastTournamentState();

    // フェーズ遷移（onHandSettled から呼ばれるので finalizeHand 完了後）
    this.handlePhaseTransition(remaining);
  }

  /**
   * 残りプレイヤー数に応じたフェーズ遷移
   * onHandSettled 経由で呼ばれるため、TableInstance の finalizeHand 完了後に実行される
   */
  private handlePhaseTransition(remaining: number): void {
    if (remaining <= 1) {
      this.completeTournament();
    } else if (remaining === 2) {
      this.status = 'heads_up';
      if (this.tables.size > 1) {
        this.scheduleFormFinalTable();
      } else {
        // 既に1テーブル: ヘッズアップ開始を許可
        const table = this.tables.values().next().value;
        if (table) table.setMinPlayersToStart(2);
        this.broadcastTournamentState();
      }
    } else if (remaining <= PLAYERS_PER_TABLE && this.tables.size > 1) {
      this.scheduleFormFinalTable();
    } else {
      this.checkAndExecuteBalance();
    }
  }

  // ============================================
  // Private: Blind Level
  // ============================================

  private onBlindLevelUp(newLevel: BlindLevel, nextLevel: BlindLevel | null): void {
    const blindsStr = `${newLevel.smallBlind}/${newLevel.bigBlind}`;

    // 全テーブルのブラインドを更新
    for (const table of this.tables.values()) {
      table.updateBlinds(blindsStr);
    }

    // 全プレイヤーに通知
    this.io.to(this.roomName).emit('tournament:blind_change', {
      level: newLevel,
      nextLevel,
      nextLevelAt: this.blindScheduler.getNextLevelAt(),
    });

    console.log(`[Tournament ${this.id}] Blind level up: ${blindsStr}`);
    this.broadcastTournamentState();
  }

  // ============================================
  // Private: Table Balancing
  // ============================================

  private checkAndExecuteBalance(): void {
    const tableInfos = Array.from(this.tables.entries()).map(([tableId, table]) => ({
      tableId,
      playerCount: table.getPlayerCount(),
      isHandInProgress: table.isHandInProgress,
    }));

    const actions = TableBalancer.checkBalance(
      tableInfos,
      (tableId) => this.getTablePlayerIds(tableId),
      this.config.playersPerTable
    );

    for (const action of actions) {
      const table = this.tables.get(action.fromTableId);
      if (table?.isHandInProgress) {
        // ハンド中はペンディングに追加
        this.pendingMoves.push({
          odId: action.odId,
          fromTableId: action.fromTableId,
          toTableId: action.toTableId,
        });
      } else {
        this.movePlayer(action.odId, action.fromTableId, action.toTableId);
      }
    }

    // 空テーブルの削除
    for (const [tableId, table] of this.tables) {
      if (table.getPlayerCount() === 0) {
        this.tables.delete(tableId);
        this.tablePlayerMap.delete(tableId);
      }
    }
  }

  private executePendingMoves(): void {
    const moves = [...this.pendingMoves];
    this.pendingMoves = [];

    for (const move of moves) {
      // 移動先テーブルがまだ存在するか確認
      if (this.tables.has(move.toTableId)) {
        this.movePlayer(move.odId, move.fromTableId, move.toTableId);
      }
    }

    // 移動後にバランスを再チェック
    if (moves.length > 0) {
      this.checkAndExecuteBalance();
    }
  }

  private movePlayer(odId: string, fromTableId: string, toTableId: string): void {
    const player = this.players.get(odId);
    if (!player || !player.socket) return;

    const fromTable = this.tables.get(fromTableId);
    const toTable = this.tables.get(toTableId);
    if (!fromTable || !toTable) return;

    // テーブル移動通知
    player.socket.emit('tournament:table_move', {
      fromTableId,
      toTableId,
      reason: 'テーブルバランス調整',
    });

    // チップを記録して離席
    const chips = fromTable.getPlayerChips(odId) ?? player.chips;
    fromTable.unseatPlayer(odId);
    this.untrackPlayerFromTable(odId, fromTableId);

    // 新テーブルに着席
    const seatIndex = this.seatPlayerAtTable(player, toTable, chips);

    if (seatIndex !== null) {
      player.socket.emit('tournament:table_assigned', {
        tableId: toTableId,
        tournamentId: this.id,
      });

      toTable.triggerMaybeStartHand();
    } else {
      // 着席失敗: 元テーブルに戻す
      console.error(`[Tournament ${this.id}] Failed to move ${odId} to ${toTableId}, seating back at ${fromTableId}`);
      this.seatPlayerAtTable(player, fromTable, chips);
    }

    console.log(`[Tournament ${this.id}] Moved player ${odId} from ${fromTableId} to ${toTableId}`);
  }

  // ============================================
  // Private: Final Table & Completion
  // ============================================

  private pendingFinalTable = false;

  /**
   * ファイナルテーブル形成をスケジュール。
   * ハンド中のテーブルがあれば onHandSettled で再試行する。
   */
  private scheduleFormFinalTable(): void {
    const anyHandInProgress = Array.from(this.tables.values()).some(t => t.isHandInProgress);
    if (anyHandInProgress) {
      this.pendingFinalTable = true;
      console.log(`[Tournament ${this.id}] Final table formation deferred (hands in progress)`);
      return;
    }
    this.formFinalTable();
  }

  private formFinalTable(): void {
    this.pendingFinalTable = false;
    this.status = 'final_table';

    const remaining = this.getPlayersRemaining();
    if (remaining <= PLAYERS_PER_TABLE && this.tables.size <= 1) {
      // 既に1テーブルなら何もしない
      this.io.to(this.roomName).emit('tournament:final_table', {
        tableId: Array.from(this.tables.keys())[0],
      });
      this.broadcastTournamentState();
      return;
    }

    // 新しいファイナルテーブルを作成
    const finalTable = this.createTournamentTable();

    // 全プレイヤーを移動
    const playingPlayers = Array.from(this.players.values())
      .filter(p => p.status === 'playing' || p.status === 'disconnected');

    for (const player of playingPlayers) {
      if (player.tableId) {
        const oldTable = this.tables.get(player.tableId);
        if (oldTable && oldTable.id !== finalTable.id) {
          const chips = oldTable.getPlayerChips(player.odId) ?? player.chips;
          oldTable.unseatPlayer(player.odId);
          this.untrackPlayerFromTable(player.odId, player.tableId);

          this.seatPlayerAtTable(player, finalTable, chips);
        }
      }
    }

    // 古いテーブルを削除
    for (const [tableId] of this.tables) {
      if (tableId !== finalTable.id) {
        this.tables.delete(tableId);
        this.tablePlayerMap.delete(tableId);
      }
    }

    // ヘッズアップなら2人でハンド開始を許可
    if (remaining <= 2) {
      finalTable.setMinPlayersToStart(2);
    }

    this.io.to(this.roomName).emit('tournament:final_table', {
      tableId: finalTable.id,
    });

    finalTable.triggerMaybeStartHand();
    this.broadcastTournamentState();

    console.log(`[Tournament ${this.id}] Final table formed with ${playingPlayers.length} players`);
  }

  private completeTournament(): void {
    this.status = 'completed';
    this.blindScheduler.stop();

    // 優勝者の確定
    const winner = Array.from(this.players.values()).find(
      p => p.status === 'playing' || p.status === 'disconnected'
    );

    if (winner) {
      winner.finishPosition = 1;
      winner.status = 'eliminated'; // 全員が最終的にeliminated
    }

    // 結果を構築（既に計算済みの this.prizes を参照）
    const results = Array.from(this.players.values())
      .filter(p => p.finishPosition !== null)
      .sort((a, b) => a.finishPosition! - b.finishPosition!)
      .map(p => ({
        odId: p.odId,
        odName: p.odName,
        position: p.finishPosition!,
        prize: this.getPrizeForPosition(p.finishPosition!),
        reentries: p.reentryCount,
      }));

    // 全プレイヤーに結果通知
    this.io.to(this.roomName).emit('tournament:completed', {
      results,
      totalPlayers: this.getTotalEntries(),
      prizePool: this.prizePool,
    });

    this.cleanupTablesAndTimers();

    this.onTournamentComplete?.(this.id, results);

    console.log(`[Tournament ${this.id}] Tournament completed! Winner: ${winner?.odName}`);
  }

  // ============================================
  // Private: Helpers
  // ============================================

  /** テーブルの全プレイヤーを離席させ、テーブルと切断タイマーをクリアする */
  private cleanupTablesAndTimers(): void {
    for (const table of this.tables.values()) {
      for (const player of this.players.values()) {
        if (player.tableId === table.id) {
          table.unseatPlayer(player.odId);
        }
      }
    }
    this.tables.clear();
    this.tablePlayerMap.clear();

    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();
  }

  private getTotalEntries(): number {
    // リエントリー分も含めた総エントリー数
    let total = 0;
    for (const p of this.players.values()) {
      total += 1 + p.reentryCount;
    }
    return total;
  }

  /** this.prizes から順位に対応する賞金額を取得（0-indexed position） */
  private getPrizeForPosition(position: number): number {
    const entry = this.prizes.find(p => p.position === position);
    return entry?.amount ?? 0;
  }

  private broadcastTournamentState(): void {
    // 各プレイヤーに個別の状態を送信（myChips, myTableIdが異なるため）
    for (const player of this.players.values()) {
      if (player.socket) {
        player.socket.emit('tournament:state', this.getClientState(player.odId));
      }
    }
  }
}
