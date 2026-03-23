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
} from './types.js';
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
  private disconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly io: Server;
  private readonly roomName: string;

  // 外部通知用コールバック
  public onTournamentComplete?: (tournamentId: string) => void;

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

        const seatIndex = table.seatPlayer(
          odId,
          player.odName,
          player.socket!,
          player.chips,
          player.avatarUrl,
          undefined,
          { skipJoinedEmit: false },
          player.nameMasked,
          player.displayName
        );

        if (seatIndex !== null) {
          player.tableId = table.id;
          player.seatIndex = seatIndex;
          this.trackPlayerAtTable(odId, table.id);
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

    // 全テーブルのプレイヤーを離席
    for (const table of this.tables.values()) {
      for (const player of this.players.values()) {
        if (player.tableId === table.id) {
          table.unseatPlayer(player.odId);
        }
      }
    }

    this.tables.clear();
    this.tablePlayerMap.clear();

    // 切断タイマーをクリア
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();

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

    if (player.status !== 'disconnected' && player.status !== 'playing') return false;

    // 切断タイマーをクリア
    const timer = this.disconnectTimers.get(odId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(odId);
    }

    player.status = 'playing';
    player.socket = socket;

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
    };

    const table = new TableInstance(this.io, blindsStr, false, {
      gameMode: 'tournament',
      lifecycleCallbacks: callbacks,
    });

    this.tables.set(table.id, table);
    this.tablePlayerMap.set(table.id, new Set());

    return table;
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

    const seatIndex = bestTable.seatPlayer(
      player.odId,
      player.odName,
      player.socket!,
      player.chips,
      player.avatarUrl,
      undefined,
      undefined,
      player.nameMasked,
      player.displayName
    );

    if (seatIndex !== null) {
      player.tableId = bestTable.id;
      player.seatIndex = seatIndex;
      this.trackPlayerAtTable(player.odId, bestTable.id);

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

  private onPlayerBusted(odId: string, _seatIndex: number, socket: Socket | null): void {
    const player = this.players.get(odId);
    if (!player) return;

    const remaining = this.getPlayersRemaining() - 1; // この人を引いた残り
    player.status = 'eliminated';
    player.chips = 0;
    player.finishPosition = remaining + 1;
    player.eliminatedAt = new Date();
    player.tableId = null;
    player.seatIndex = null;

    // テーブルトラッキングから削除
    for (const [tableId, playerSet] of this.tablePlayerMap) {
      if (playerSet.has(odId)) {
        this.untrackPlayerFromTable(odId, tableId);
        break;
      }
    }

    // 賞金チェック
    const prize = PrizeCalculator.getPrizeForPosition(
      player.finishPosition,
      this.getTotalEntries(),
      this.prizePool,
      this.config.payoutPercentage
    );

    // 個人通知
    socket?.emit('tournament:eliminated', {
      position: player.finishPosition,
      totalPlayers: this.getTotalEntries(),
      prizeAmount: prize,
    });

    // 全体通知
    this.io.to(this.roomName).emit('tournament:player_eliminated', {
      odId,
      odName: player.odName,
      position: player.finishPosition,
      playersRemaining: remaining,
    });

    console.log(`[Tournament ${this.id}] Player ${odId} eliminated at position ${player.finishPosition}, ${remaining} remaining`);

    // 残りプレイヤー数に応じたフェーズ遷移
    if (remaining <= 1) {
      this.completeTournament();
    } else if (remaining === 2) {
      this.status = 'heads_up';
      if (this.tables.size > 1) {
        this.formFinalTable();
      } else {
        this.broadcastTournamentState();
      }
    } else if (remaining <= PLAYERS_PER_TABLE && this.tables.size > 1) {
      this.formFinalTable();
    } else {
      // テーブルバランスチェック
      this.checkAndExecuteBalance();
    }
  }

  private onHandSettled(seatChips: { odId: string; seatIndex: number; chips: number }[]): void {
    // トーナメントプレイヤーのチップを同期
    for (const { odId, chips } of seatChips) {
      const player = this.players.get(odId);
      if (player) {
        player.chips = chips;
      }
    }

    // ペンディング移動の実行
    this.executePendingMoves();
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
    const seatIndex = toTable.seatPlayer(
      odId,
      player.odName,
      player.socket,
      chips,
      player.avatarUrl,
      undefined,
      undefined,
      player.nameMasked,
      player.displayName
    );

    if (seatIndex !== null) {
      player.tableId = toTableId;
      player.seatIndex = seatIndex;
      player.chips = chips;
      this.trackPlayerAtTable(odId, toTableId);

      player.socket.emit('tournament:table_assigned', {
        tableId: toTableId,
        tournamentId: this.id,
      });

      toTable.triggerMaybeStartHand();
    }

    console.log(`[Tournament ${this.id}] Moved player ${odId} from ${fromTableId} to ${toTableId}`);
  }

  // ============================================
  // Private: Final Table & Completion
  // ============================================

  private formFinalTable(): void {
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

          if (player.socket) {
            const seatIndex = finalTable.seatPlayer(
              player.odId,
              player.odName,
              player.socket,
              chips,
              player.avatarUrl,
              undefined,
              undefined,
              player.nameMasked,
              player.displayName
            );

            if (seatIndex !== null) {
              player.tableId = finalTable.id;
              player.seatIndex = seatIndex;
              player.chips = chips;
              this.trackPlayerAtTable(player.odId, finalTable.id);
            }
          }
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

    // 結果を構築
    const results = Array.from(this.players.values())
      .filter(p => p.finishPosition !== null)
      .sort((a, b) => a.finishPosition! - b.finishPosition!)
      .map(p => ({
        odId: p.odId,
        odName: p.odName,
        position: p.finishPosition!,
        prize: PrizeCalculator.getPrizeForPosition(
          p.finishPosition!,
          this.getTotalEntries(),
          this.prizePool,
          this.config.payoutPercentage
        ),
        reentries: p.reentryCount,
      }));

    // 全プレイヤーに結果通知
    this.io.to(this.roomName).emit('tournament:completed', {
      results,
      totalPlayers: this.getTotalEntries(),
      prizePool: this.prizePool,
    });

    // テーブルをクリーンアップ
    for (const table of this.tables.values()) {
      for (const player of this.players.values()) {
        if (player.tableId === table.id) {
          table.unseatPlayer(player.odId);
        }
      }
    }
    this.tables.clear();
    this.tablePlayerMap.clear();

    // 切断タイマーをクリア
    for (const timer of this.disconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.disconnectTimers.clear();

    this.onTournamentComplete?.(this.id);

    console.log(`[Tournament ${this.id}] Tournament completed! Winner: ${winner?.odName}`);
  }

  // ============================================
  // Private: Helpers
  // ============================================

  private getTotalEntries(): number {
    // リエントリー分も含めた総エントリー数
    let total = 0;
    for (const p of this.players.values()) {
      total += 1 + p.reentryCount;
    }
    return total;
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
