import { Server, Socket } from 'socket.io';
import { GameState, Action } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getActivePlayers } from '../../shared/logic/gameEngine.js';
import { ClientGameState } from '../../shared/types/websocket.js';
import { nanoid } from 'nanoid';

// ヘルパーモジュール
import { TABLE_CONSTANTS } from './constants.js';
import { MessageLog, PendingAction } from './types.js';
import { PlayerManager } from './helpers/PlayerManager.js';
import { ActionController } from './helpers/ActionController.js';
import { BroadcastService } from './helpers/BroadcastService.js';
import { StateTransformer } from './helpers/StateTransformer.js';
import { FoldProcessor } from './helpers/FoldProcessor.js';
import { HandHistoryRecorder } from './helpers/HandHistoryRecorder.js';

// 型の再エクスポート（後方互換性のため）
export type { MessageLog, PendingAction };

export class TableInstance {
  public readonly id: string;
  public readonly blinds: string;
  public readonly smallBlind: number;
  public readonly bigBlind: number;
  public readonly maxPlayers: number = TABLE_CONSTANTS.MAX_PLAYERS;
  public isFastFold: boolean = false;

  private gameState: GameState | null = null;
  private isHandInProgress = false;
  private pendingStartHand = false;

  // ヘルパーインスタンス
  private readonly playerManager: PlayerManager;
  private readonly broadcast: BroadcastService;
  private readonly foldProcessor: FoldProcessor;
  private readonly actionController: ActionController;
  private readonly historyRecorder: HandHistoryRecorder;

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
  }

  // Get room name for this table
  private get roomName() {
    return `table:${this.id}`;
  }

  // ダッシュボード用：ゲーム状態詳細を取得
  public getDebugState(): {
    messageLog: MessageLog[];
    pendingAction: PendingAction | null;
    gamePhase: string;
  } {
    return {
      messageLog: this.broadcast.getMessageLog(),
      pendingAction: this.actionController.getPendingAction(),
      gamePhase: this.isHandInProgress
        ? (this.gameState?.currentStreet ?? 'unknown')
        : 'waiting',
    };
  }

  // Add a player to the table
  public seatPlayer(
    odId: string,
    odName: string,
    socket: Socket,
    buyIn: number,
    avatarUrl?: string | null,
    preferredSeat?: number
  ): number | null {
    const seatIndex = this.playerManager.seatPlayer({
      odId,
      odName,
      socket,
      buyIn,
      avatarUrl,
      preferredSeat,
      isHandInProgress: this.isHandInProgress,
    });

    if (seatIndex === null) return null;

    socket.join(this.roomName);

    // Broadcast player joined
    const seat = this.playerManager.getSeat(seatIndex)!;
    const joinData = {
      seat: seatIndex,
      player: StateTransformer.seatToOnlinePlayer(seat, seatIndex, null),
    };
    this.broadcast.emitToRoom('table:player_joined', joinData);

    // Send current table state to the newly seated player
    const clientState = this.getClientGameState();
    this.broadcast.emitToSocket(socket, odId, 'game:state', { state: clientState });

    // Start hand if enough players
    this.maybeStartHand();

    return seatIndex;
  }

  // Remove a player from the table
  public unseatPlayer(odId: string): void {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return;

    const seat = this.playerManager.getSeat(seatIndex);
    if (seat?.socket) {
      // プレイヤーにテーブルを離れたことを通知
      seat.socket.emit('table:left');
      seat.socket.leave(this.roomName);
    }

    // Check if this player was the one we're waiting for action
    const wasCurrentPlayer = this.gameState &&
      !this.gameState.isHandComplete &&
      this.gameState.currentPlayerIndex === seatIndex;

    this.playerManager.unseatPlayer(seatIndex);

    this.broadcast.emitToRoom('table:player_left', { seat: seatIndex, odId });

    // If in a hand, fold the player
    if (this.gameState && !this.gameState.isHandComplete) {
      const result = this.foldProcessor.processFold(this.gameState, {
        seatIndex,
        playerId: odId,
        wasCurrentPlayer: wasCurrentPlayer ?? false,
      });
      this.gameState = result.gameState;

      if (result.requiresAdvance) {
        this.actionController.clearTimers();
        this.advanceToNextPlayer();
      }
    }
  }

  // Advance game to next player after a fold
  private advanceToNextPlayer(): void {
    if (!this.gameState || this.gameState.isHandComplete) return;

    const result = this.actionController.advanceToNextPlayer(
      this.gameState,
      this.playerManager.getSeats()
    );

    this.gameState = result.gameState;

    if (result.handComplete) {
      this.broadcastGameState();
      this.handleHandComplete();
    } else {
      this.requestNextAction();
      this.broadcastGameState();
    }
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete) return false;

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    const result = this.actionController.handleAction(
      this.gameState,
      seatIndex,
      action,
      amount,
      odId
    );

    if (!result.success) return false;

    this.gameState = result.gameState;

    // Check if hand is complete
    if (result.handComplete) {
      this.broadcastGameState();
      this.handleHandComplete();
    } else if (result.streetChanged) {
      // ストリートが変わった場合は遅延後に次のアクションを要求
      this.actionController.scheduleStreetTransition(() => {
        this.broadcastGameState();
        this.requestNextAction();
      });
    } else {
      // 次のアクション要求後に状態をブロードキャスト（pendingActionがセットされている状態で送信するため）
      this.requestNextAction();
      this.broadcastGameState();
    }

    return true;
  }

  // Handle fast fold
  public handleFastFold(odId: string): void {
    if (!this.isFastFold) return;

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return;

    if (this.gameState && !this.gameState.isHandComplete) {
      // Fold the player
      if (this.gameState.currentPlayerIndex === seatIndex) {
        this.handleAction(odId, 'fold', 0);
      } else {
        // Pre-fold (mark for folding when turn comes)
        const result = this.foldProcessor.processFold(this.gameState, {
          seatIndex,
          playerId: odId,
          wasCurrentPlayer: false,
        });
        this.gameState = result.gameState;
      }
    }

    // Emit event for MatchmakingPool to handle re-queuing
    const seat = this.playerManager.getSeat(seatIndex);
    if (seat?.socket) {
      seat.socket.emit('matchmaking:ready_for_new_table');
    }
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

  // Private methods

  private maybeStartHand(): void {
    if (this.isHandInProgress || this.pendingStartHand) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < 2) return;

    this.pendingStartHand = true;

    // Delay before starting new hand
    setTimeout(() => {
      this.startNewHand();
      this.pendingStartHand = false;
    }, TABLE_CONSTANTS.HAND_START_DELAY_MS);
  }

  private startNewHand(): void {
    if (this.isHandInProgress) return;

    // Re-check player count (players may have disconnected during the delay)
    const playerCount = this.getPlayerCount();
    if (playerCount < 2) return;

    this.isHandInProgress = true;

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
      } else {
        // 空席のプレイヤーはチップ0にしてゲームに参加させない
        this.gameState.players[i].chips = 0;
      }
    }

    // Start the hand (this will increment dealerPosition and update positions)
    this.gameState = startNewHand(this.gameState);

    // 空席のプレイヤーをfoldedにする（startNewHandがfoldedをリセットするため、後で処理）
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      if (!seats[i]) {
        this.gameState.players[i].folded = true;
        this.gameState.players[i].hasActed = true;
      }
    }

    // Send hole cards to each player (human and bot)
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat?.socket) {
        const holeCardsData = { cards: this.gameState.players[i].holeCards };
        this.broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', holeCardsData);
      }
    }

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
      this.handleHandComplete();
      return;
    }

    this.actionController.requestNextAction(
      this.gameState,
      this.playerManager.getSeats(),
      (playerId, seatIndex) => this.handleActionTimeout(playerId, seatIndex),
      () => this.advanceToNextPlayer()
    );
  }

  private handleActionTimeout(playerId: string, seatIndex: number): void {
    // Check if player is still at the table
    const seat = this.playerManager.getSeat(seatIndex);
    if (seat && seat.odId === playerId) {
      // Player still there, force fold via handleAction
      this.handleAction(playerId, 'fold', 0);
    } else {
      // Player already left, but game might be stuck - advance if needed
      if (this.gameState &&
          !this.gameState.isHandComplete &&
          this.gameState.currentPlayerIndex === seatIndex) {
        // Game is stuck waiting for this player, advance
        this.gameState = this.foldProcessor.processSilentFold(this.gameState, seatIndex);
        this.actionController.clearTimers();
        this.advanceToNextPlayer();
      }
    }
  }

  private handleHandComplete(): void {
    if (!this.gameState) return;

    // Clear pending action
    this.actionController.clearTimers();

    // ハンドヒストリー保存 (fire-and-forget)
    const seats = this.playerManager.getSeats();
    this.historyRecorder.recordHandComplete(
      this.id,
      this.blinds,
      this.gameState,
      seats
    ).catch(err => console.error('Hand history save failed:', err));

    // Broadcast winners
    const handCompleteData = {
      winners: this.gameState.winners.map(w => ({
        playerId: seats[w.playerId]?.odId || '',
        amount: w.amount,
        handName: w.handName,
      })),
    };
    this.broadcast.emitToRoom('game:hand_complete', handCompleteData);

    // Showdown - reveal cards
    if (this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1) {
      const showdownData = {
        winners: this.gameState.winners.map(w => ({
          playerId: seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: this.gameState!.players[w.playerId].holeCards,
        })),
      };
      this.broadcast.emitToRoom('game:showdown', showdownData);
    }

    // Update seat chips
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      // waitingForNextHandのプレイヤーはハンドに参加していないのでチップを上書きしない
      if (seat && this.gameState.players[i] && !seat.waitingForNextHand) {
        this.playerManager.updateChips(i, this.gameState.players[i].chips);
      }
    }

    this.isHandInProgress = false;

    // Remove busted players
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat && seat.chips <= 0) {
        // Notify player they're busted
        seat.socket?.emit('table:error', { message: 'You have run out of chips!' });
        this.unseatPlayer(seat.odId);
      }
    }

    // Start next hand if enough players
    this.maybeStartHand();
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;

    const clientState = this.getClientGameState();
    this.broadcast.emitToRoom('game:state', { state: clientState });
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
}
