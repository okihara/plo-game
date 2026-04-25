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
  private status: TournamentStatus = 'waiting';
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
    // completed/cancelled は確定済み
    if (this.status === 'completed' || this.status === 'cancelled') return this.status;
    // final_table, heads_up はゲーム中に設定される
    if (this.status === 'final_table' || this.status === 'heads_up') return this.status;
    // waiting/running は開始時刻から動的判定
    if (!this.blindScheduler.isStarted() && !this.isScheduledTimePassed()) {
      return 'waiting';
    }
    return 'running';
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

  /** 観戦の前後テーブル移動用（安定した順序） */
  public getTableIdsSorted(): string[] {
    return Array.from(this.tables.keys()).sort();
  }

  public getPlayer(odId: string): TournamentPlayer | undefined {
    return this.players.get(odId);
  }

  public getPrizePool(): number {
    return this.prizePool;
  }

  public getResults(): TournamentResult[] {
    return Array.from(this.players.values())
      .filter(p => p.finishPosition !== null)
      .sort((a, b) => a.finishPosition! - b.finishPosition!)
      .map(p => ({
        odId: p.odId,
        odName: p.displayName ?? (p.nameMasked ? maskName(p.odName) : p.odName),
        position: p.finishPosition!,
        prize: this.getPrizeForPosition(p.finishPosition!),
        reentries: p.reentryCount,
        avatarUrl: p.avatarUrl,
      }));
  }

  // ============================================
  // Registration
  // ============================================

  /**
   * トーナメントに参加（新規参加・リエントリーを統合）
   *
   * - 新規: running中（登録期間内） → 即テーブル着席
   * - リエントリー: eliminated状態 → チップリセット＋テーブル着席
   */
  public enterPlayer(
    odId: string,
    odName: string,
    socket: Socket,
    options?: {
      displayName?: string | null;
      avatarId?: number;
      avatarUrl?: string | null;
      nameMasked?: boolean;
      hasWeeklyChampion?: boolean;
    }
  ): { success: boolean; error?: string } {
    const existingPlayer = this.players.get(odId);

    // --- リエントリー ---
    if (existingPlayer) {
      return this.handleReentry(existingPlayer, socket);
    }

    // --- 新規参加 ---
    if (this.getStatus() === 'waiting') {
      return { success: false, error: 'トーナメントはまだ開始されていません' };
    }

    // BlindScheduler 未開始なら開始（予定時刻を過ぎて最初のプレイヤーが来た時）
    if (!this.blindScheduler.isStarted()) {
      console.log(`[Tournament ${this.id}] Auto-starting (first player entered after scheduled time)`);
      this.start();
    }

    if (!this.isRegistrationOpen()) {
      return { success: false, error: 'トーナメントの登録受付は終了しています' };
    }

    if (this.players.size >= this.config.maxPlayers) {
      return { success: false, error: '定員に達しています' };
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
      status: 'playing',
      finishPosition: null,
      reentryCount: 0,
      registeredAt: new Date(),
      eliminatedAt: null,
      nameMasked: options?.nameMasked ?? true,
      hasWeeklyChampion: options?.hasWeeklyChampion ?? false,
    };

    this.players.set(odId, player);
    this.prizePool += this.config.buyIn;

    // トーナメントルームに参加
    socket.join(this.roomName);

    // 賞金構造を再計算
    this.prizes = PrizeCalculator.calculate(
      this.getTotalEntries(),
      this.prizePool,
      this.config.payoutPercentage
    );

    // テーブルに着席
    this.seatPlayerAtAvailableTable(player);

    // レイト登録直後に人数差が開いている場合は、その場で再調整する。
    this.checkAndExecuteBalance();

    this.broadcastTournamentState();
    return { success: true };
  }

  /**
   * リエントリー処理（enterPlayerから呼ばれる内部メソッド）
   */
  private handleReentry(
    player: TournamentPlayer,
    socket: Socket
  ): { success: boolean; error?: string } {
    if (player.status !== 'eliminated') {
      return { success: false, error: 'プレイ中のためリエントリーできません' };
    }

    if (!this.config.allowReentry) {
      return { success: false, error: 'リエントリー不可のトーナメントです' };
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

    // リエントリーで短卓が発生した場合、次のハンド完了まで待たせない。
    this.checkAndExecuteBalance();

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
    if (this.blindScheduler.isStarted()) {
      return { success: false, error: 'トーナメントは既に開始しています' };
    }

    // 予定開始時刻があればそこを基準に、なければ現在時刻で開始
    const startTime = this.config.scheduledStartTime
      ? (this.config.scheduledStartTime instanceof Date
        ? this.config.scheduledStartTime
        : new Date(this.config.scheduledStartTime as unknown as string))
      : new Date();

    this.blindScheduler.startFrom(startTime, (newLevel, nextLevel) => {
      this.onBlindLevelUp(newLevel, nextLevel);
    });

    this.status = 'running';

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

  public isRegistrationOpen(): boolean {
    const status = this.getStatus();
    if (status !== 'running') return false;
    const currentLevel = this.blindScheduler.getCurrentLevelIndex() + 1;
    return currentLevel <= this.config.registrationLevels;
  }

  /**
   * 予定開始時刻を過ぎているか
   */
  public isScheduledTimePassed(): boolean {
    if (!this.config.scheduledStartTime) return true; // 時刻未指定は即開始可能
    const scheduled = this.config.scheduledStartTime instanceof Date
      ? this.config.scheduledStartTime.getTime()
      : new Date(this.config.scheduledStartTime as unknown as string).getTime();
    return Date.now() >= scheduled;
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
      isRegistrationOpen: this.isRegistrationOpen(),
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
      scheduledStartTime: this.config.scheduledStartTime
        ? (this.config.scheduledStartTime instanceof Date
          ? this.config.scheduledStartTime.toISOString()
          : String(this.config.scheduledStartTime))
        : undefined,
      isRegistrationOpen: this.isRegistrationOpen(),
      allowReentry: this.config.allowReentry,
      maxReentries: this.config.maxReentries,
      totalReentries: this.getTotalReentries(),
      reentryDeadlineLevel: this.config.reentryDeadlineLevel,
      registrationDeadlineAt: this.blindScheduler.isStarted()
        ? new Date(this.blindScheduler.getLevelStartTimestamp(this.config.registrationLevels)).toISOString()
        : undefined,
    };
  }

  // ============================================
  // Private: Table Management
  // ============================================

  private createTournamentTable(): TableInstance {
    const currentLevel = this.blindScheduler.getCurrentLevel();
    const blindsStr = `${currentLevel.smallBlind}/${currentLevel.bigBlind}`;

    const callbacks: TableLifecycleCallbacks = {
      onPlayerBusted: (odId, seatIndex, socket, chipsAtHandStart) => {
        this.onPlayerBusted(odId, seatIndex, socket, chipsAtHandStart);
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
      onHandPresentationComplete: () => {
        this.onHandPresentationComplete();
      },
    };

    const table = new TableInstance(this.io, blindsStr, false, {
      gameMode: 'tournament',
      lifecycleCallbacks: callbacks,
      tournamentId: this.id,
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
    const seatIndex = table.seatPlayer(
      player.odId,
      player.odName,
      player.socket,
      chips,
      player.avatarUrl,
      undefined,
      options,
      player.nameMasked,
      player.displayName,
      player.hasWeeklyChampion
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
   * 実際の順位確定・フェーズ遷移は onBustsProcessed で一括処理する。
   */
  private onPlayerBusted(
    odId: string,
    _seatIndex: number,
    socket: Socket | null,
    chipsAtHandStart: number
  ): void {
    const player = this.players.get(odId);
    if (!player) return;

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

    // バスト情報を蓄積（onBustsProcessed で一括順位計算）
    this.pendingBusts.push({ odId, socket, chipsAtHandStart });
  }

  /**
   * ハンド完了時: チップ同期のみを行う
   */
  private onHandSettled(seatChips: { odId: string; seatIndex: number; chips: number }[]): void {
    // ハンド間でブラインドレベル変更を検知
    this.blindScheduler.tick();

    // トーナメントプレイヤーのチップを同期
    for (const { odId, chips } of seatChips) {
      const player = this.players.get(odId);
      if (player) {
        player.chips = chips;
      }
    }
  }

  /**
   * ハンド結果の表示待ち完了後: テーブル移動やファイナルテーブル形成を実行
   */
  private onHandPresentationComplete(): void {
    // ペンディングのファイナルテーブル形成
    if (this.pendingFinalTable) {
      this.scheduleFormFinalTable();
    }

    // バランスを再チェック
    this.checkAndExecuteBalance();

    // ペンディング移動の実行 → バランスチェック（executePendingMoves 内で実行）
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

      // 個人通知（レイト登録中は順位未確定のためnull）
      bust.socket?.emit('tournament:eliminated', {
        position: this.isRegistrationOpen() ? null : player.finishPosition,
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
        position: this.isRegistrationOpen() ? null : player.finishPosition,
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
  // Public: Admin Operations
  // ============================================

  /** 管理者が手動でテーブルバランシングを実行する */
  forceRebalance(): void {
    console.log(`[Tournament ${this.id}] Force rebalance triggered by admin`);
    this.checkAndExecuteBalance();
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
        table.disconnectAllSpectators('トーナメントテーブルが閉じられました');
        this.tables.delete(tableId);
        this.tablePlayerMap.delete(tableId);
      }
    }
  }

  private executePendingMoves(): void {
    const moves = [...this.pendingMoves];
    this.pendingMoves = [];

    for (const move of moves) {
      // 移動先テーブルがまだ存在し、プレイヤーがまだ移動元にいるか確認
      const fromTable = this.tables.get(move.fromTableId);
      if (this.tables.has(move.toTableId) && fromTable?.getPlayerChips(move.odId) !== null) {
        this.movePlayer(move.odId, move.fromTableId, move.toTableId);
      }
    }
  }

  private movePlayer(odId: string, fromTableId: string, toTableId: string): void {
    const player = this.players.get(odId);
    if (!player) return;

    const fromTable = this.tables.get(fromTableId);
    const toTable = this.tables.get(toTableId);
    if (!fromTable || !toTable) return;

    // 0チップのプレイヤーは bust 確定（onPlayerBusted が遅延実行される前の状態）なので移動しない。
    // onHandSettled → checkAndExecuteBalance の時点では status はまだ 'playing' だが、
    // seat.chips と player.chips は既に 0 に同期されている。ここで移動すると別テーブルに
    // 0チップ着席してしまうため早期リターンする。
    const fromChips = fromTable.getPlayerChips(odId);
    if (fromChips === 0 || player.chips === 0) {
      return;
    }

    // テーブル移動通知（切断中は通知スキップ）
    player.socket?.emit('tournament:table_move', {
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
      player.socket?.emit('tournament:table_assigned', {
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
   * ハンド中のテーブルがあれば結果表示完了後に再試行する。
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
        this.tables.get(tableId)?.disconnectAllSpectators('ファイナルテーブルに統合されました');
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
    const results = this.getResults();

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

  /**
   * 指定プレイヤーがリエントリー可能かどうかを判定する
   */
  public canReenter(odId: string): boolean {
    const player = this.players.get(odId);
    if (!player || player.status !== 'eliminated') return false;
    if (!this.config.allowReentry) return false;
    if (player.reentryCount >= this.config.maxReentries) return false;
    const currentLevel = this.blindScheduler.getCurrentLevelIndex() + 1;
    if (currentLevel > this.config.reentryDeadlineLevel) return false;
    return true;
  }

  private getTotalReentries(): number {
    let total = 0;
    for (const p of this.players.values()) {
      total += p.reentryCount;
    }
    return total;
  }

  public getTotalEntries(): number {
    // リエントリー分も含めた総エントリー数
    let total = 0;
    for (const p of this.players.values()) {
      total += 1 + p.reentryCount;
    }
    return total;
  }

  /** this.prizes から順位に対応する賞金額を取得（0-indexed position） */
  public getPrizeForPosition(position: number): number {
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
