import { Server, Socket } from 'socket.io';
import { GameState, Action } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getActivePlayers, getValidActions, determineWinner, calculateSidePots } from '../../shared/logic/gameEngine.js';
import { evaluatePLOHand } from '../../shared/logic/handEvaluator.js';
import { calculateAllInEVProfits } from '../../shared/logic/equityCalculator.js';
import { ClientGameState } from '../../shared/types/websocket.js';
import { nanoid } from 'nanoid';

// ヘルパーモジュール
import { TABLE_CONSTANTS } from './constants.js';
import { MessageLog, PendingAction, AdminSeat, DebugState } from './types.js';
import { PlayerManager } from './helpers/PlayerManager.js';
import { ActionController } from './helpers/ActionController.js';
import { BroadcastService } from './helpers/BroadcastService.js';
import { StateTransformer } from './helpers/StateTransformer.js';
import { FoldProcessor } from './helpers/FoldProcessor.js';
import { HandHistoryRecorder } from './helpers/HandHistoryRecorder.js';
import { AdminHelper } from './helpers/AdminHelper.js';
import { SpectatorManager } from './helpers/SpectatorManager.js';
import { AsyncQueue } from './AsyncQueue.js';
import { TimerScheduler } from './TimerScheduler.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';

// 型の再エクスポート（後方互換性のため）
export type { MessageLog, PendingAction };

export class TableInstance {
  public readonly id: string;
  public readonly blinds: string;
  public readonly smallBlind: number;
  public readonly bigBlind: number;
  public readonly maxPlayers: number = TABLE_CONSTANTS.MAX_PLAYERS;
  public isFastFold: boolean = false;

  // ファストフォールド: ハンド完了後に全プレイヤーを再割り当てするコールバック
  public onFastFoldReassign?: (players: { odId: string; chips: number; socket: Socket; odName: string; avatarUrl: string | null; nameMasked: boolean }[]) => Promise<void> | void;

  private gameState: GameState | null = null;
  private isRunOutInProgress = false;
  private showdownSentDuringRunOut = false;
  private _isHandInProgress = false;

  public get isHandInProgress(): boolean {
    return this._isHandInProgress;
  }
  private pendingStartHand = false;

  // ファストフォールド: 手番が来るまで保留するフォールド (seatIndex → odId)
  private pendingEarlyFolds: Map<number, string> = new Map();

  // Actor パターン: キューとタイマー
  private readonly queue: AsyncQueue;
  private readonly timers: TimerScheduler;

  // ヘルパーインスタンス
  private readonly playerManager: PlayerManager;
  private readonly broadcast: BroadcastService;
  private readonly foldProcessor: FoldProcessor;
  private readonly actionController: ActionController;
  private readonly historyRecorder: HandHistoryRecorder;
  private readonly adminHelper: AdminHelper;
  private readonly spectatorManager: SpectatorManager;

  constructor(io: Server, blinds: string = '1/3', isFastFold: boolean = false) {
    this.id = nanoid(12);
    this.blinds = blinds;
    this.isFastFold = isFastFold;

    const [sb, bb] = blinds.split('/').map(Number);
    this.smallBlind = sb;
    this.bigBlind = bb;

    // Actor インフラ初期化
    this.queue = new AsyncQueue();
    this.timers = new TimerScheduler();

    // ヘルパー初期化
    const roomName = `table:${this.id}`;
    this.playerManager = new PlayerManager();
    this.broadcast = new BroadcastService(io, roomName);
    this.foldProcessor = new FoldProcessor(this.broadcast);
    this.actionController = new ActionController(this.broadcast);
    this.historyRecorder = new HandHistoryRecorder();
    this.adminHelper = new AdminHelper(this.playerManager, this.broadcast, this.actionController);
    this.spectatorManager = new SpectatorManager(roomName, this.playerManager);
  }

  // ============================================
  // Public methods (キュー経由で状態変更を直列化)
  // ============================================

  // Add a player to the table
  public seatPlayer(
    odId: string,
    odName: string,
    socket: Socket,
    buyIn: number,
    avatarUrl?: string | null,
    preferredSeat?: number,
    options?: { skipJoinedEmit?: boolean },
    nameMasked?: boolean
  ): Promise<number | null> {
    return this.queue.enqueue(async () => {
      return this._seatPlayer(odId, odName, socket, buyIn, avatarUrl, preferredSeat, options, nameMasked);
    });
  }

  // Remove a player from the table
  public unseatPlayer(odId: string): Promise<{ odId: string; chips: number } | null> {
    return this.queue.enqueue(async () => {
      return this._unseatPlayer(odId);
    });
  }

  // ファストフォールド用: フォールド済みプレイヤーを静かに離席させる
  public unseatForFastFold(odId: string): Promise<{ odId: string; chips: number; socket: Socket | null } | null> {
    return this.queue.enqueue(async () => {
      return this._unseatForFastFold(odId);
    });
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): Promise<boolean> {
    return this.queue.enqueue(async () => {
      return this._handleAction(odId, action, amount);
    });
  }

  // ファストフォールド用: ターン前にフォールドして即座にテーブル移動可能にする
  public handleEarlyFold(odId: string): Promise<boolean> {
    return this.queue.enqueue(async () => {
      return this._handleEarlyFold(odId);
    });
  }

  public triggerMaybeStartHand(): Promise<void> {
    return this.queue.enqueue(async () => {
      this._maybeStartHand();
    });
  }

  // デバッグ用: チップ強制変更
  public debugSetChips(odId: string, chips: number): Promise<boolean> {
    return this.queue.enqueue(async () => {
      return this.adminHelper.debugSetChips(odId, chips, this.gameState, () => this.broadcastGameState());
    });
  }

  // ============================================
  // Public methods (読み取り専用 — キュー不要)
  // ============================================

  public getConnectedPlayerCount(): number {
    return this.playerManager.getConnectedPlayerCount();
  }

  public getPlayerCount(): number {
    return this.playerManager.getPlayerCount();
  }

  public hasAvailableSeat(): boolean {
    return this.playerManager.hasAvailableSeat();
  }

  public getTableInfo() {
    return {
      id: this.id,
      name: `Table ${this.id.slice(0, 4)}`,
      blinds: this.blinds,
      players: this.getPlayerCount(),
      maxPlayers: this.maxPlayers,
      isFastFold: this.isFastFold,
    };
  }

  public getClientGameState(): ClientGameState {
    return StateTransformer.toClientGameState(
      this.id,
      this.playerManager.getSeats(),
      this.gameState,
      this.actionController.getPendingAction(),
      this.isHandInProgress,
      this.smallBlind,
      this.bigBlind
    );
  }

  // スペクテーター管理
  public addSpectator(socket: Socket): void {
    this.spectatorManager.addSpectator(socket);
  }

  public sendAllHoleCardsToSpectator(socket: Socket): void {
    this.spectatorManager.sendAllHoleCards(socket, this.gameState, this.isHandInProgress);
  }

  // デバッグ・管理用
  public getDebugState(): DebugState {
    return this.adminHelper.getDebugState(this.gameState, this.isHandInProgress);
  }

  public getAdminSeats(): (AdminSeat | null)[] {
    return this.adminHelper.getAdminSeats(this.gameState);
  }

  // ============================================
  // Private: キュー内で実行される状態変更メソッド
  // ============================================

  private get roomName() {
    return `table:${this.id}`;
  }

  private _seatPlayer(
    odId: string,
    odName: string,
    socket: Socket,
    buyIn: number,
    avatarUrl?: string | null,
    preferredSeat?: number,
    options?: { skipJoinedEmit?: boolean },
    nameMasked?: boolean
  ): number | null {
    const seatIndex = this.playerManager.seatPlayer({
      odId,
      odName,
      socket,
      buyIn,
      avatarUrl,
      preferredSeat,
      isHandInProgress: this.isHandInProgress,
      nameMasked,
    });

    if (seatIndex === null) {
      console.warn(`[Table ${this.id}] seatPlayer failed: odId=${odId}, odName=${odName}, buyIn=${buyIn}, preferredSeat=${preferredSeat}, handInProgress=${this.isHandInProgress}`);
      return null;
    }

    socket.join(this.roomName);

    // Notify the seated player
    if (!options?.skipJoinedEmit) {
      socket.emit('table:joined', { tableId: this.id, seat: seatIndex });
    }
    this.broadcast.emitToRoom('game:state', { state: this.getClientGameState() });

    // NOTE: triggerMaybeStartHand() is NOT called here.
    // The caller must call it after completing tracking setup,
    // to ensure table:joined arrives before game:hole_cards on the client.

    return seatIndex;
  }

  private _unseatPlayer(odId: string): { odId: string; chips: number } | null {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) {
      console.error(`Player ${odId} not found in table ${this.id}`);
      return null;
    }

    const seat = this.playerManager.getSeat(seatIndex);

    // チップ数を取得（ハンド中はgameStateの値が最新）
    let chips = seat?.chips ?? 0;
    if (this.gameState && this.gameState.players[seatIndex] && !this.gameState.isHandComplete) {
      chips = this.gameState.players[seatIndex].chips;
    }

    if (seat?.socket) {
      seat.socket.emit('table:left');
      seat.socket.leave(this.roomName);
    }

    // Check if this player was the one we're waiting for action
    const wasCurrentPlayer = this.gameState &&
      !this.gameState.isHandComplete &&
      this.gameState.currentPlayerIndex === seatIndex;

    // 保留フォールドがあれば削除
    this.pendingEarlyFolds.delete(seatIndex);

    // If in a hand, fold the player and keep seat info for history/display
    if (this.gameState && !this.gameState.isHandComplete) {
      this.playerManager.markLeftForFastFold(seatIndex);

      const result = this.foldProcessor.processFold(this.gameState, {
        seatIndex,
        playerId: odId,
        wasCurrentPlayer: wasCurrentPlayer ?? false,
      });
      this.gameState = result.gameState;

      if (result.requiresAdvance) {
        this.timers.cancel('action');
        this.actionController.clearPendingAction();
        this._advanceToNextPlayer();
      }
    } else {
      this.playerManager.unseatPlayer(seatIndex);
    }

    return { odId, chips };
  }

  private _unseatForFastFold(odId: string): { odId: string; chips: number; socket: Socket | null } | null {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return null;

    const seat = this.playerManager.getSeat(seatIndex);
    if (!seat) return null;

    // チップ数を取得（ハンド中はgameStateの値が最新）
    let chips = seat.chips;
    if (this.gameState && this.gameState.players[seatIndex]) {
      chips = this.gameState.players[seatIndex].chips;
    }

    const socket = seat.socket ?? null;

    if (socket) {
      socket.leave(this.roomName);
    }

    this.playerManager.markLeftForFastFold(seatIndex);

    return { odId, chips, socket };
  }

  private _handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      console.warn(`[Table ${this.id}] handleAction rejected: odId=${odId}, action=${action}, amount=${amount}, gameState=${!this.gameState ? 'null' : 'exists'}, isHandComplete=${this.gameState?.isHandComplete}, isRunOutInProgress=${this.isRunOutInProgress}`);
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) {
      console.warn(`[Table ${this.id}] handleAction: player not found at table, odId=${odId}`);
      return false;
    }

    // タイマークリア（アクション受付時にタイムアウトを停止）
    this.timers.cancel('action');
    this.actionController.clearPendingAction();

    // ランアウト検出用にカード枚数を保存
    const previousCardCount = this.gameState.communityCards.length;

    // アクションを処理
    const result = this.actionController.handleAction(
      this.gameState,
      seatIndex,
      action,
      amount,
      odId
    );

    if (!result.success) {
      console.warn(`[Table ${this.id}] handleAction: action rejected by controller, odId=${odId}, seat=${seatIndex}, action=${action}, amount=${amount}, currentPlayer=${this.gameState.currentPlayerIndex}`);
      // アクション拒否時はタイマーを再設定
      this._requestNextAction();
      return false;
    }

    this.gameState = result.gameState;

    // Check if hand is complete
    if (result.handComplete) {
      const finalCardCount = this.gameState.communityCards.length;
      if (finalCardCount > previousCardCount) {
        // オールインでのランアウト: ストリートごとに段階的にカードを表示
        this._handleAllInRunOut(this.gameState, previousCardCount);
      } else {
        // 通常のハンド完了（全員フォールド or リバーベッティング終了）
        this.broadcastGameState();
        this._handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
      }
    } else if (result.streetChanged) {
      // アクション演出を待ってからコミュニティカードを表示
      this.timers.schedule('actionAnimation', TABLE_CONSTANTS.ACTION_ANIMATION_DELAY_MS, () => {
        this.queue.enqueue(async () => {
          this.broadcastGameState();
          // プレイヤーがカードを確認できるよう遅延後に次のアクションを要求
          this.timers.schedule('streetTransition', TABLE_CONSTANTS.STREET_TRANSITION_DELAY_MS, () => {
            this.queue.enqueue(async () => {
              this._requestNextAction();
              this.broadcastGameState();
            });
          });
        });
      });
    } else {
      // 次のアクション要求後に状態をブロードキャスト
      this._requestNextAction();
      this.broadcastGameState();
    }

    return true;
  }

  private _handleEarlyFold(odId: string): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    const player = this.gameState.players[seatIndex];
    if (!player || player.folded || player.isAllIn) return false;

    if (this.pendingEarlyFolds.has(seatIndex)) return false;

    // BBはプリフロップでファストフォールドできない
    if (player.position === 'BB' && this.gameState.currentStreet === 'preflop') {
      return false;
    }

    const wasCurrentPlayer = this.gameState.currentPlayerIndex === seatIndex;

    if (!wasCurrentPlayer) {
      this.pendingEarlyFolds.set(seatIndex, odId);
      return true;
    }

    return this._handleAction(odId, "fold", 0);
  }

  // ============================================
  // Private: ゲーム進行ロジック
  // ============================================

  private _advanceToNextPlayer(): void {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) return;

    const result = this.actionController.advanceToNextPlayer(
      this.gameState,
      this.playerManager.getSeats()
    );

    this.gameState = result.gameState;

    if (result.handComplete) {
      this.broadcastGameState();
      this._handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
    } else {
      this._requestNextAction();
      this.broadcastGameState();
    }
  }

  private get minPlayersToStart(): number {
    return this.isFastFold ? TABLE_CONSTANTS.MAX_PLAYERS : TABLE_CONSTANTS.MIN_PLAYERS_TO_START;
  }

  private _maybeStartHand(): void {
    if (this.isHandInProgress || this.pendingStartHand) return;
    if (maintenanceService.isMaintenanceActive()) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < this.minPlayersToStart) return;

    this._startNewHand();
  }

  private _startNewHand(): void {
    if (this.isHandInProgress) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < this.minPlayersToStart) return;

    this._isHandInProgress = true;
    this.pendingEarlyFolds.clear();

    // Preserve dealer position from previous hand
    const previousDealerPosition = this.gameState?.dealerPosition ?? -1;

    // Create initial game state
    const buyInChips = this.bigBlind * TABLE_CONSTANTS.DEFAULT_BUYIN_MULTIPLIER;
    this.gameState = createInitialGameState(buyInChips);
    this.gameState.smallBlind = this.smallBlind;
    this.gameState.bigBlind = this.bigBlind;

    // Restore dealer position
    if (previousDealerPosition >= 0) {
      this.gameState.dealerPosition = previousDealerPosition;
    }

    // Clear waiting flags and sync chips from seats to game state
    this.playerManager.clearWaitingFlags();

    const seats = this.playerManager.getSeats();
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat) {
        this.gameState.players[i].chips = seat.chips;
        this.gameState.players[i].name = seat.odName;
        this.gameState.players[i].isSittingOut = false;
      } else {
        this.gameState.players[i].chips = 0;
        this.gameState.players[i].isSittingOut = true;
      }
    }

    // Start the hand
    this.gameState = startNewHand(this.gameState);

    // Send hole cards to each player
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat?.socket) {
        const holeCardsData = { cards: this.gameState.players[i].holeCards };
        this.broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', holeCardsData);
      }
    }

    // スペクテーターに全員のホールカードを送信
    this.broadcastAllHoleCardsToSpectators();

    // ハンドヒストリー用スナップショット記録
    this.historyRecorder.recordHandStart(seats, this.gameState);

    // Request first action then broadcast
    this._requestNextAction();
    this.broadcastGameState();
  }

  /**
   * 次のアクションをリクエスト（タイマー設定 + game:action_required 送信）
   * ActionController から移動: タイマー管理を TimerScheduler に統合するため
   */
  private _requestNextAction(): void {
    if (!this.gameState || this.gameState.isHandComplete) return;

    // currentPlayerIndex が -1 の場合（全員オールインなど）
    if (this.gameState.currentPlayerIndex === -1) {
      this._handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
      return;
    }

    // Pending early fold: 手番が回ってきたプレイヤーの保留フォールドを処理
    while (this.pendingEarlyFolds.has(this.gameState.currentPlayerIndex)) {
      const seatIndex = this.gameState.currentPlayerIndex;
      const odId = this.pendingEarlyFolds.get(seatIndex)!;

      const foldResult = this.foldProcessor.processFold(this.gameState, {
        seatIndex,
        playerId: odId,
        wasCurrentPlayer: true,
      });
      this.gameState = foldResult.gameState;
      this.pendingEarlyFolds.delete(seatIndex);

      // アクティブプレイヤーが1人以下 → ハンド終了
      const activePlayers = getActivePlayers(this.gameState);
      if (activePlayers.length <= 1) {
        this.timers.cancelAll();
        this.actionController.clearPendingAction();
        this.gameState = determineWinner(this.gameState, TABLE_CONSTANTS.RAKE_PERCENT, TABLE_CONSTANTS.RAKE_CAP_BB);
        this.broadcastGameState();
        this._handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
        return;
      }

      // 次のプレイヤーへ進む
      const advResult = this.actionController.advanceToNextPlayer(
        this.gameState,
        this.playerManager.getSeats()
      );
      this.gameState = advResult.gameState;

      if (advResult.handComplete) {
        this.broadcastGameState();
        this._handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
        return;
      }
    }

    const currentPlayerIndex = this.gameState.currentPlayerIndex;
    const seats = this.playerManager.getSeats();
    const currentSeat = seats[currentPlayerIndex];

    // 切断・離席済みプレイヤーの処理
    if (!currentSeat || !currentSeat.socket) {
      this._advanceToNextPlayer();
      return;
    }

    const validActions = getValidActions(this.gameState, currentPlayerIndex);

    // ダッシュボード用の pendingAction 設定
    this.actionController.setPendingAction({
      playerId: currentSeat.odId,
      playerName: currentSeat.odName,
      seatNumber: currentPlayerIndex,
      validActions: validActions.map(a => ({
        action: a.action,
        minAmount: a.minAmount,
        maxAmount: a.maxAmount,
      })),
      requestedAt: Date.now(),
      timeoutMs: TABLE_CONSTANTS.ACTION_TIMEOUT_MS,
    });

    // アクション要求を送信
    this.broadcast.emitToSocket(
      currentSeat.socket,
      currentSeat.odId,
      'game:action_required',
      {
        playerId: currentSeat.odId,
        validActions,
        timeoutMs: TABLE_CONSTANTS.ACTION_TIMEOUT_MS,
      }
    );

    // タイムアウトタイマー設定（コールバックはキュー経由で安全に実行）
    const playerIdForTimeout = currentSeat.odId;
    const seatIndexForTimeout = currentPlayerIndex;
    this.timers.schedule('action', TABLE_CONSTANTS.ACTION_TIMEOUT_MS, () => {
      this.queue.enqueue(async () => {
        this._handleActionTimeout(playerIdForTimeout, seatIndexForTimeout);
      });
    });
  }

  private _handleActionTimeout(playerId: string, seatIndex: number): void {
    console.warn(`[Table ${this.id}] Action timeout: playerId=${playerId}, seat=${seatIndex}`);
    const seat = this.playerManager.getSeat(seatIndex);
    if (seat && seat.odId === playerId) {
      if (this.gameState) {
        const validActions = getValidActions(this.gameState, seatIndex);
        const canCheck = validActions.some(a => a.action === 'check');
        this._handleAction(playerId, canCheck ? 'check' : 'fold', 0);
      } else {
        this._handleAction(playerId, 'fold', 0);
      }
    } else {
      // Player already left, but game might be stuck
      if (this.gameState &&
          !this.gameState.isHandComplete &&
          this.gameState.currentPlayerIndex === seatIndex) {
        this.gameState = this.foldProcessor.processSilentFold(this.gameState, seatIndex);
        this.timers.cancel('action');
        this.actionController.clearPendingAction();
        this._advanceToNextPlayer();
      }
    }
  }

  /**
   * オールイン時のランアウト: 全員のカードを公開してから、コミュニティカードをストリートごとに段階的に表示する
   */
  private async _handleAllInRunOut(finalState: GameState, previousCardCount: number): Promise<void> {
    console.warn(`[Table ${this.id}] handleAllInRunOut: previousCardCount=${previousCardCount}`);

    // ランアウト前のボードでEV計算
    try {
      const priorBoard = finalState.communityCards.slice(0, previousCardCount);
      const allPots = calculateSidePots(finalState.players);
      const totalBets = new Map<number, number>();
      const allPlayerInfo = finalState.players.map(p => {
        totalBets.set(p.id, p.totalBetThisRound);
        return { playerId: p.id, holeCards: p.holeCards, folded: p.folded || p.isSittingOut };
      });
      const evProfits = calculateAllInEVProfits(priorBoard, allPlayerInfo, allPots, totalBets);
      this.historyRecorder.setAllInEVProfits(evProfits);
      console.warn(`[Table ${this.id}] All-in EV profits:`, Object.fromEntries(evProfits));
    } catch (err) {
      console.error(`[Table ${this.id}] EV calculation failed:`, err);
    }

    const allCards = [...finalState.communityCards];

    // 表示ステージを構築
    const stages: { cardCount: number; street: 'flop' | 'turn' | 'river' }[] = [];
    if (previousCardCount < 3) {
      stages.push({ cardCount: 3, street: 'flop' });
    }
    if (previousCardCount < 4) {
      stages.push({ cardCount: 4, street: 'turn' });
    }
    if (previousCardCount < 5) {
      stages.push({ cardCount: 5, street: 'river' });
    }

    this.isRunOutInProgress = true;
    this.timers.cancelAll();
    this.actionController.clearPendingAction();

    // ショーダウン: ボードランアウトの前に全員のカードを公開する
    const seats = this.playerManager.getSeats();
    const activePlayers = getActivePlayers(finalState);
    if (activePlayers.length > 1) {
      const showdownPlayers = activePlayers.map(p => {
        const winnerEntry = finalState.winners.find(w => w.playerId === p.id);
        let handName = winnerEntry?.handName || '';
        if (!handName && finalState.communityCards.length === 5) {
          try {
            const result = evaluatePLOHand(p.holeCards, finalState.communityCards);
            handName = result.name;
          } catch (e) { console.warn('Showdown hand evaluation failed for seat', p.id, e); }
        }
        return {
          seatIndex: p.id,
          odId: seats[p.id]?.odId || '',
          cards: p.holeCards,
          handName,
        };
      });
      const showdownData = {
        winners: finalState.winners.map(w => ({
          playerId: seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: finalState.players[w.playerId].holeCards,
        })),
        players: showdownPlayers,
      };

      await this.timers.delay('showdownReveal', 2000);
      this.broadcast.emitToRoom('game:showdown', showdownData);
      this.showdownSentDuringRunOut = true;
      await this.timers.delay('showdownReveal', 2000);
    }

    // ストリートごとに段階的にカードを表示（async/await で直線的に記述）
    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];

      // 中間状態を作成
      const intermediateState = JSON.parse(JSON.stringify(finalState)) as GameState;
      intermediateState.communityCards = allCards.slice(0, stage.cardCount);
      intermediateState.isHandComplete = false;
      intermediateState.winners = [];
      intermediateState.currentStreet = stage.street;
      intermediateState.currentPlayerIndex = -1;

      this.gameState = intermediateState;
      this.broadcastGameState();

      // 次ステージまでの遅延
      const nextStage = stages[i + 1];
      const delay = nextStage?.street === 'river'
        ? TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS * 1.5
        : TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS;
      await this.timers.delay('runOut', delay);
    }

    // 全カード表示完了 → 最終結果を表示
    this.isRunOutInProgress = false;
    this.gameState = finalState;
    this.broadcastGameState();
    await this._handleHandComplete();
  }

  private async _handleHandComplete(): Promise<void> {
    if (!this.gameState) {
      console.error(`[Table ${this.id}] handleHandComplete called but gameState is null`);
      return;
    }

    // タイマー全クリア + フラグリセット
    this.timers.cancelAll();
    this.actionController.clearPendingAction();
    this.isRunOutInProgress = false;
    this.pendingEarlyFolds.clear();

    // ハンドヒストリー保存 (fire-and-forget)
    const seatsSnapshot = this.playerManager.getSeats().map(s => s ? { ...s } : null);
    this.historyRecorder.recordHandComplete(
      this.id,
      this.blinds,
      this.gameState,
      seatsSnapshot
    ).catch(err => console.error('Hand history save failed:', err));

    // Showdown - reveal cards (ランアウト時は handleAllInRunOut で送信済みなのでスキップ)
    const seats = this.playerManager.getSeats();
    if (this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1 && !this.showdownSentDuringRunOut) {
      const activePlayers = getActivePlayers(this.gameState);
      const showdownPlayers = activePlayers.map(p => {
        const winnerEntry = this.gameState!.winners.find(w => w.playerId === p.id);
        let handName = winnerEntry?.handName || '';
        if (!handName && this.gameState!.communityCards.length === 5) {
          try {
            const result = evaluatePLOHand(p.holeCards, this.gameState!.communityCards);
            handName = result.name;
          } catch (e) { console.warn('Showdown hand evaluation failed for seat', p.id, e); }
        }
        return {
          seatIndex: p.id,
          odId: seats[p.id]?.odId || '',
          cards: p.holeCards,
          handName,
        };
      });
      const showdownData = {
        winners: this.gameState.winners.map(w => ({
          playerId: seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: this.gameState!.players[w.playerId].holeCards,
        })),
        players: showdownPlayers,
      };

      await this.timers.delay('showdownReveal', TABLE_CONSTANTS.SHOWDOWN_DELAY_MS);
      this.broadcast.emitToRoom('game:showdown', showdownData);
    }
    this.showdownSentDuringRunOut = false;

    // ハンド完了時の演出ウェイト
    await this.timers.delay('handComplete', TABLE_CONSTANTS.HAND_COMPLETE_DELAY_MS);

    // Broadcast winners
    const handCompleteData = {
      winners: this.gameState.winners.map(w => ({
        playerId: seats[w.playerId]?.odId || '',
        amount: w.amount,
        handName: w.handName,
      })),
      rake: this.gameState.rake,
    };
    this.broadcast.emitToRoom('game:hand_complete', handCompleteData);

    // Update seat chips
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat && this.gameState.players[i] && !seat.waitingForNextHand) {
        this.playerManager.updateChips(i, this.gameState.players[i].chips);
      }
    }

    this._isHandInProgress = false;
    this.pendingStartHand = true;

    // ショーダウン時はカードを確認する時間を長めに取る
    const wasShowdown = this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1;
    const delay = wasShowdown ? TABLE_CONSTANTS.NEXT_HAND_SHOWDOWN_DELAY_MS : TABLE_CONSTANTS.NEXT_HAND_DELAY_MS;
    await this.timers.delay('nextHand', delay);

    // Remove busted players and players who left during hand
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (!seat) continue;
      if (seat.leftForFastFold) {
        this.playerManager.unseatPlayer(i);
      } else if (seat.chips <= 0) {
        seat.socket?.emit('table:busted', { message: 'チップがなくなりました' });
        this._unseatPlayer(seat.odId);
      }
    }
    this.pendingStartHand = false;

    // ファストフォールド: 残り全プレイヤーを新テーブルに再割り当て
    if (this.isFastFold && this.onFastFoldReassign) {
      const playersToMove: { odId: string; chips: number; socket: Socket; odName: string; avatarUrl: string | null; nameMasked: boolean }[] = [];
      const currentSeats = this.playerManager.getSeats();
      for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
        const seat = currentSeats[i];
        if (!seat) continue;

        if (seat.leftForFastFold) {
          this.playerManager.unseatPlayer(i);
          continue;
        }

        if (seat.socket) {
          playersToMove.push({
            odId: seat.odId,
            chips: seat.chips,
            socket: seat.socket,
            odName: seat.odName,
            avatarUrl: seat.avatarUrl,
            nameMasked: seat.nameMasked,
          });
          seat.socket.leave(this.roomName);
          this.playerManager.unseatPlayer(i);
        }
      }
      if (playersToMove.length > 0) {
        await this.onFastFoldReassign(playersToMove);
      }
      return;
    }

    this._maybeStartHand();
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;

    const clientState = this.getClientGameState();
    this.broadcast.emitToRoom('game:state', { state: clientState });
  }

  private broadcastAllHoleCardsToSpectators(): void {
    this.spectatorManager.broadcastAllHoleCards(this.gameState);
  }
}
