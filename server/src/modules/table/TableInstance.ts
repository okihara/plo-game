import { Server, Socket } from 'socket.io';
import { GameState, Action } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getActivePlayers, getValidActions, calculateSidePots } from '../../shared/logic/gameEngine.js';
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
  public onFastFoldReassign?: (players: { odId: string; chips: number; socket: Socket; odName: string; displayName?: string | null; avatarUrl: string | null; nameMasked: boolean; rankingBadges?: string[] }[]) => void;

  // ファストフォールド: タイムアウトフォールド時にテーブル移動するコールバック
  public onTimeoutFold?: (odId: string, socket: Socket) => Promise<void>;

  private gameState: GameState | null = null;
  private runOutTimer: NodeJS.Timeout | null = null;
  private isRunOutInProgress = false;
  private showdownSentDuringRunOut = false;
  private _isHandInProgress = false;

  public get isHandInProgress(): boolean {
    return this._isHandInProgress;
  }
  private pendingStartHand = false;

  // ファストフォールド: 手番が来るまで保留するフォールド (seatIndex → odId)
  private pendingEarlyFolds: Map<number, string> = new Map();

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
  // Public methods
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
    nameMasked?: boolean,
    displayName?: string | null,
    rankingBadges?: string[]
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
      displayName,
      rankingBadges,
    });

    if (seatIndex === null) {
      console.warn(`[Table ${this.id}] seatPlayer failed: odId=${odId}, odName=${odName}, buyIn=${buyIn}, preferredSeat=${preferredSeat}, handInProgress=${this.isHandInProgress}`);
      return null;
    }

    socket.join(this.roomName);

    // Broadcast player joined
    const seat = this.playerManager.getSeat(seatIndex)!;
    const joinData = {
      seat: seatIndex,
      player: StateTransformer.seatToOnlinePlayer(seat, seatIndex, null),
    };

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

  // Remove a player from the table
  public unseatPlayer(odId: string): { odId: string; chips: number } | null {
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
      // プレイヤーにテーブルを離れたことを通知
      seat.socket.emit('table:left');
      seat.socket.leave(this.roomName);
    }

    // Check if this player was the one we're waiting for action
    const wasCurrentPlayer = this.gameState &&
      !this.gameState.isHandComplete &&
      this.gameState.currentPlayerIndex === seatIndex;

    // 保留フォールドがあれば削除（離席処理で再設定するため）
    this.pendingEarlyFolds.delete(seatIndex);

    // If in a hand, fold the player and keep seat info for history/display
    if (this.gameState && !this.gameState.isHandComplete) {
      this.playerManager.markLeftForFastFold(seatIndex);

      if (wasCurrentPlayer) {
        // 自分のターン → applyAction('fold') 経由で正規のフォールド処理
        this.actionController.clearTimers();
        this.handleAction(odId, 'fold', 0);
      } else {
        // 自分のターンではない → 手番が来るまで保留（情報漏洩を防ぐ）
        this.pendingEarlyFolds.set(seatIndex, odId);
      }
    } else {
      this.playerManager.unseatPlayer(seatIndex);
    }

    return { odId, chips };
  }

  // ファストフォールド用: フォールド済みプレイヤーを静かに離席させる
  // table:left は送信しない（table:change を代わりに送るため）
  public unseatForFastFold(odId: string): { odId: string; chips: number; socket: Socket | null } | null {
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

    // ソケットをルームから離脱
    if (socket) {
      socket.leave(this.roomName);
    }

    // 席情報は残してFastFold移動済みマーク（ハンド終了まで表示用に保持）
    this.playerManager.markLeftForFastFold(seatIndex);

    return { odId, chips, socket };
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      console.warn(`[Table ${this.id}] handleAction rejected: odId=${odId}, action=${action}, amount=${amount}, gameState=${!this.gameState ? 'null' : 'exists'}, isHandComplete=${this.gameState?.isHandComplete}, isRunOutInProgress=${this.isRunOutInProgress}`);
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) {
      console.warn(`[Table ${this.id}] handleAction: player not found at table, odId=${odId}`);
      return false;
    }
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
      return false;
    }

    this.gameState = result.gameState;

    // Check if hand is complete
    if (result.handComplete) {
      const finalCardCount = this.gameState.communityCards.length;
      if (finalCardCount > previousCardCount) {
        // オールインでのランアウト: ストリートごとに段階的にカードを表示
        this.handleAllInRunOut(this.gameState, previousCardCount);
      } else {
        // 通常のハンド完了（全員フォールド or リバーベッティング終了）
        this.broadcastGameState();
        this.handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
      }
    } else if (result.streetChanged) {
      // アクション演出を待ってからコミュニティカードを表示
      this.actionController.scheduleActionAnimation(() => {
        this.broadcastGameState();
        // プレイヤーがカードを確認できるよう遅延後に次のアクションを要求
        this.actionController.scheduleStreetTransition(() => {
          this.requestNextAction();
          this.broadcastGameState();
        });
      });
    } else {
      // 次のアクション要求後に状態をブロードキャスト（pendingActionがセットされている状態で送信するため）
      this.requestNextAction();
      this.broadcastGameState();
    }

    return true;
  }

  /**
   * ファストフォールド用: ターン前にフォールドして即座にテーブル移動可能にする
   * BBはプリフロップでファストフォールドできない
   */
  public handleEarlyFold(odId: string): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    const player = this.gameState.players[seatIndex];
    if (!player || player.folded || player.isAllIn) return false;

    // 既に保留中のフォールドがある場合は無視
    if (this.pendingEarlyFolds.has(seatIndex)) return false;

    // BBはプリフロップでファストフォールドできない
    if (player.position === 'BB' && this.gameState.currentStreet === 'preflop') {
      return false;
    }

    const wasCurrentPlayer = this.gameState.currentPlayerIndex === seatIndex;

    if (!wasCurrentPlayer) {
      // 自分のターンではない: フォールドを保留（手番が来たときに処理される）
      this.pendingEarlyFolds.set(seatIndex, odId);
      return true;
    }

    return this.handleAction(odId, "fold", 0);
  }

  public triggerMaybeStartHand(): void {
    this.maybeStartHand();
  }

  // Get the number of connected players
  public getConnectedPlayerCount(): number {
    return this.playerManager.getConnectedPlayerCount();
  }

  // Get total player count
  public getPlayerCount(): number {
    return this.playerManager.getPlayerCount();
  }

  // Check if table has available seats
  public hasAvailableSeat(): boolean {
    return this.playerManager.hasAvailableSeat();
  }

  // Get table info for lobby
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

  public debugSetChips(odId: string, chips: number): boolean {
    return this.adminHelper.debugSetChips(odId, chips, this.gameState, () => this.broadcastGameState());
  }

  public getAdminSeats(): (AdminSeat | null)[] {
    return this.adminHelper.getAdminSeats(this.gameState);
  }

  // ============================================
  // Private methods
  // ============================================

  private get roomName() {
    return `table:${this.id}`;
  }

  private advanceToNextPlayer(): void {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) return;

    const result = this.actionController.advanceToNextPlayer(
      this.gameState,
      this.playerManager.getSeats()
    );

    this.gameState = result.gameState;

    if (result.handComplete) {
      this.broadcastGameState();
      this.handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
    } else {
      this.requestNextAction();
      this.broadcastGameState();
    }
  }

  private get minPlayersToStart(): number {
    return this.isFastFold ? TABLE_CONSTANTS.MAX_PLAYERS : TABLE_CONSTANTS.MIN_PLAYERS_TO_START;
  }

  private maybeStartHand(): void {
    if (this.isHandInProgress || this.pendingStartHand) return;
    if (maintenanceService.isMaintenanceActive()) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < this.minPlayersToStart) return;

    this.startNewHand();
  }

  private startNewHand(): void {
    if (this.isHandInProgress) return;

    // Re-check player count (players may have disconnected during the delay)
    const playerCount = this.getPlayerCount();
    if (playerCount < this.minPlayersToStart) return;

    this._isHandInProgress = true;
    this.pendingEarlyFolds.clear(); // safety

    // Preserve dealer position from previous hand
    const previousDealerPosition = this.gameState?.dealerPosition ?? -1;

    // Create initial game state
    const buyInChips = this.bigBlind * TABLE_CONSTANTS.DEFAULT_BUYIN_MULTIPLIER;
    this.gameState = createInitialGameState(buyInChips);
    this.gameState.smallBlind = this.smallBlind;
    this.gameState.bigBlind = this.bigBlind;

    // Restore dealer position (startNewHand will increment it)
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
        // 空席はシッティングアウトとしてマーク
        this.gameState.players[i].chips = 0;
        this.gameState.players[i].isSittingOut = true;
      }
    }

    // Start the hand (this will increment dealerPosition and update positions)
    this.gameState = startNewHand(this.gameState);

    // Send hole cards to each player (human and bot)
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

    // Request first action then broadcast (so pendingAction is set)
    this.requestNextAction();
    this.broadcastGameState();
  }

  private requestNextAction(): void {
    if (!this.gameState || this.gameState.isHandComplete) return;

    // currentPlayerIndex が -1 の場合（全員オールインなど）はハンド完了処理へ
    if (this.gameState.currentPlayerIndex === -1) {
      this.handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
      return;
    }

    // Pending early fold: 手番が回ってきたプレイヤーの保留フォールドを処理
    // handleAction → applyAction('fold') で正規のフォールド処理を行う
    // handleAction 内で requestNextAction が再帰的に呼ばれ、連続する pending fold も処理される
    if (this.pendingEarlyFolds.has(this.gameState.currentPlayerIndex)) {
      const seatIndex = this.gameState.currentPlayerIndex;
      const odId = this.pendingEarlyFolds.get(seatIndex)!;
      this.pendingEarlyFolds.delete(seatIndex);
      this.handleAction(odId, 'fold', 0);
      return;
    }

    this.actionController.requestNextAction(
      this.gameState,
      this.playerManager.getSeats(),
      (playerId, seatIndex) => {
        this.handleActionTimeout(playerId, seatIndex)
          .catch(err => console.error(`[Table ${this.id}] handleActionTimeout error:`, err));
      },
      () => {
        // 切断済みプレイヤーのフォールド: handleAction 経由で正規処理
        if (!this.gameState) return;
        const idx = this.gameState.currentPlayerIndex;
        const seat = this.playerManager.getSeat(idx);
        if (seat?.odId) {
          this.handleAction(seat.odId, 'fold', 0);
        }
      }
    );
  }

  private async handleActionTimeout(playerId: string, seatIndex: number): Promise<void> {
    console.warn(`[Table ${this.id}] Action timeout: playerId=${playerId}, seat=${seatIndex}`);

    if (!this.gameState) {
      console.error(`[Table ${this.id}] Action timeout but no gameState: playerId=${playerId}, seat=${seatIndex}`);
      const seat = this.playerManager.getSeat(seatIndex);
      seat?.socket?.emit('table:error', { message: 'ゲーム状態が見つかりません。再接続してください。' });
      return;
    }

    // Check if player is still at the table
    const seat = this.playerManager.getSeat(seatIndex);
    if (seat && seat.odId === playerId) {
      // チェック可能ならチェック、そうでなければフォールド
      const validActions = getValidActions(this.gameState, seatIndex);
      const canCheck = validActions.some(a => a.action === 'check');
      const action: Action = canCheck ? 'check' : 'fold';
      const handled = this.handleAction(playerId, action, 0);

      // ファストフォールド: タイムアウトフォールド後にテーブル移動
      if (action === 'fold' && handled && this.isFastFold && seat.socket && this.onTimeoutFold) {
        await this.onTimeoutFold(playerId, seat.socket);
      }
    } else {
      // Player already left, but game might be stuck - advance if needed
      if (!this.gameState.isHandComplete &&
          this.gameState.currentPlayerIndex === seatIndex) {
        // Game is stuck waiting for this player, advance
        this.gameState = this.foldProcessor.processSilentFold(this.gameState, seatIndex);
        this.actionController.clearTimers();
        this.advanceToNextPlayer();
      }
    }
  }

  /**
   * オールイン時のランアウト: 全員のカードを公開してから、コミュニティカードをストリートごとに段階的に表示する
   * @param finalState 全カード配布済み＆勝者決定済みの最終ゲーム状態
   * @param previousCardCount ランアウト開始前のコミュニティカード枚数
   */
  private async handleAllInRunOut(finalState: GameState, previousCardCount: number): Promise<void> {
    console.warn(`[Table ${this.id}] handleAllInRunOut: previousCardCount=${previousCardCount}`);

    // ランアウト前のボードでEV計算（エクイティベース）
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

    // 表示ステージを構築（フロップ→ターン→リバーの順）
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
    // ランアウト中はアクションタイマーを確実にクリア
    this.actionController.clearTimers();

    // ショーダウン: ボードランアウトの前に全員のカードを公開する（ポーカーの正しい順序）
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

      await new Promise<void>(resolve => { setTimeout(resolve, 2000); });

      this.broadcast.emitToRoom('game:showdown', showdownData);
      this.showdownSentDuringRunOut = true;

      await new Promise<void>(resolve => { setTimeout(resolve, 2000); });
    }

    let currentStageIndex = 0;

    const revealNextStage = () => {
      this.runOutTimer = null;

      if (currentStageIndex >= stages.length) {
        // 全カード表示完了 → 最終結果を表示
        this.isRunOutInProgress = false;
        this.gameState = finalState;
        this.broadcastGameState();
        this.handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
        return;
      }

      const stage = stages[currentStageIndex];

      // 中間状態を作成（このストリートまでのカードだけ見せる）
      const intermediateState = JSON.parse(JSON.stringify(finalState)) as GameState;
      intermediateState.communityCards = allCards.slice(0, stage.cardCount);
      intermediateState.isHandComplete = false;
      intermediateState.winners = [];
      intermediateState.currentStreet = stage.street;
      intermediateState.currentPlayerIndex = -1;

      this.gameState = intermediateState;
      this.broadcastGameState();

      currentStageIndex++;
      // ターン→リバーは1.5倍のディレイ
      const nextStage = stages[currentStageIndex];
      const delay = nextStage?.street === 'river'
        ? TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS * 1.5
        : TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS;
      this.runOutTimer = setTimeout(revealNextStage, delay);
    };

    // 最初のステージを即座に表示開始
    revealNextStage();
  }

  private async handleHandComplete(): Promise<void> {
    if (!this.gameState) {
      console.error(`[Table ${this.id}] handleHandComplete called but gameState is null`);
      return;
    }

    // Clear pending action and ensure runout flag is reset (safety)
    this.actionController.clearTimers();
    this.isRunOutInProgress = false;

    // Pending early fold のクリーンアップ（unseatForFastFoldで既にマーク済み）
    this.pendingEarlyFolds.clear();

    // ハンドヒストリー保存 (fire-and-forget)
    // getSeats()は参照を返すため、非同期処理中にunseatPlayerで変更されないようコピーを取る
    const seatsSnapshot = this.playerManager.getSeats().map(s => s ? { ...s } : null);
    this.historyRecorder.recordHandComplete(
      this.id,
      this.blinds,
      this.gameState,
      seatsSnapshot
    ).catch(err => console.error('Hand history save failed:', err));

    // Showdown - reveal cards for ALL active players (showdownをhand_completeより先に送信)
    // ランアウト時は handleAllInRunOut() で既に送信済みなのでスキップ
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

      // 演出ウェイト
      await new Promise(resolve => setTimeout(resolve, TABLE_CONSTANTS.SHOWDOWN_DELAY_MS));

      this.broadcast.emitToRoom('game:showdown', showdownData);
    }
    this.showdownSentDuringRunOut = false;

    // ハンド完了時の演出ウェイト
    await new Promise(resolve => setTimeout(resolve, TABLE_CONSTANTS.HAND_COMPLETE_DELAY_MS));

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
      // waitingForNextHandのプレイヤーはハンドに参加していないのでチップを上書きしない
      if (seat && this.gameState.players[i] && !seat.waitingForNextHand) {
        this.playerManager.updateChips(i, this.gameState.players[i].chips);
      }
    }

    this._isHandInProgress = false;

    this.pendingStartHand = true;

    // 待ち時間
    // ショーダウンかどうかを記録（次ハンド開始までの待ち時間に影響）
    const wasShowdown = this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1;
    // ショーダウン時はカードを確認する時間を長めに取る
    const delay = wasShowdown ? TABLE_CONSTANTS.NEXT_HAND_SHOWDOWN_DELAY_MS : TABLE_CONSTANTS.NEXT_HAND_DELAY_MS;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Remove busted players and players who left during hand
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (!seat) continue;
      if (seat.leftForFastFold) {
        this.playerManager.unseatPlayer(i);
      } else if (seat.chips <= 0) {
        // Notify player they're busted (table:busted, NOT table:error)
        seat.socket?.emit('table:busted', { message: 'チップがなくなりました' });
        this.unseatPlayer(seat.odId);
      }
    }
    this.pendingStartHand = false;

    // ファストフォールド: 残り全プレイヤーを新テーブルに再割り当て
    if (this.isFastFold && this.onFastFoldReassign) {
      const playersToMove: { odId: string; chips: number; socket: Socket; odName: string; displayName?: string | null; avatarUrl: string | null; nameMasked: boolean; rankingBadges?: string[] }[] = [];
      const currentSeats = this.playerManager.getSeats();
      for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
        const seat = currentSeats[i];
        if (!seat) continue;

        if (seat.leftForFastFold) {
          // ハンド中にFastFold移動済み → 席をクリアするだけ
          this.playerManager.unseatPlayer(i);
          continue;
        }

        if (seat.socket) {
          playersToMove.push({
            odId: seat.odId,
            chips: seat.chips,
            socket: seat.socket,
            odName: seat.odName,
            displayName: seat.displayName,
            avatarUrl: seat.avatarUrl,
            nameMasked: seat.nameMasked,
            rankingBadges: seat.rankingBadges,
          });
          // 静かに離席（ルーム離脱 + 席クリア）
          seat.socket.leave(this.roomName);
          this.playerManager.unseatPlayer(i);
        }
      }
      if (playersToMove.length > 0) {
        this.onFastFoldReassign(playersToMove);
      }
      return;
    }

    this.maybeStartHand();
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
