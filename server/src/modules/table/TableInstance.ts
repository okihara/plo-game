import { Server, Socket } from 'socket.io';
import { GameState, Action } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getActivePlayers, getValidActions } from '../../shared/logic/gameEngine.js';
import { evaluatePLOHand } from '../../shared/logic/handEvaluator.js';
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

  private gameState: GameState | null = null;
  private runOutTimer: NodeJS.Timeout | null = null;
  private isRunOutInProgress = false;
  private showdownSentDuringRunOut = false;
  private isHandInProgress = false;
  private pendingStartHand = false;

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

    return { odId, chips };
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) return false;

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

    // ランアウト検出用にカード枚数を保存
    const previousCardCount = this.gameState.communityCards.length;

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

  private maybeStartHand(): void {
    if (this.isHandInProgress || this.pendingStartHand) return;
    if (maintenanceService.isMaintenanceActive()) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < TABLE_CONSTANTS.MIN_PLAYERS_TO_START) return;

    this.startNewHand();
  }

  private startNewHand(): void {
    if (this.isHandInProgress) return;

    // Re-check player count (players may have disconnected during the delay)
    const playerCount = this.getPlayerCount();
    if (playerCount < TABLE_CONSTANTS.MIN_PLAYERS_TO_START) return;

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
      // チェック可能ならチェック、そうでなければフォールド
      if (this.gameState) {
        const validActions = getValidActions(this.gameState, seatIndex);
        const canCheck = validActions.some(a => a.action === 'check');
        this.handleAction(playerId, canCheck ? 'check' : 'fold', 0);
      } else {
        this.handleAction(playerId, 'fold', 0);
      }
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

  /**
   * オールイン時のランアウト: 全員のカードを公開してから、コミュニティカードをストリートごとに段階的に表示する
   * @param finalState 全カード配布済み＆勝者決定済みの最終ゲーム状態
   * @param previousCardCount ランアウト開始前のコミュニティカード枚数
   */
  private handleAllInRunOut(finalState: GameState, previousCardCount: number): void {
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
      this.broadcast.emitToRoom('game:showdown', showdownData);
      this.showdownSentDuringRunOut = true;
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
      this.runOutTimer = setTimeout(revealNextStage, TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS);
    };

    // 最初のステージを即座に表示開始
    revealNextStage();
  }

  private async handleHandComplete(): Promise<void> {
    if (!this.gameState) return;

    // Clear pending action and ensure runout flag is reset (safety)
    this.actionController.clearTimers();
    this.isRunOutInProgress = false;

    // ハンドヒストリー保存 (fire-and-forget)
    const seats = this.playerManager.getSeats();
    this.historyRecorder.recordHandComplete(
      this.id,
      this.blinds,
      this.gameState,
      seats
    ).catch(err => console.error('Hand history save failed:', err));

    // Showdown - reveal cards for ALL active players (showdownをhand_completeより先に送信)
    // ランアウト時は handleAllInRunOut() で既に送信済みなのでスキップ
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

    this.isHandInProgress = false;

    this.pendingStartHand = true;

    // 待ち時間
    // ショーダウンかどうかを記録（次ハンド開始までの待ち時間に影響）
    const wasShowdown = this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1;
    // ショーダウン時はカードを確認する時間を長めに取る
    const delay = wasShowdown ? TABLE_CONSTANTS.NEXT_HAND_SHOWDOWN_DELAY_MS : TABLE_CONSTANTS.NEXT_HAND_DELAY_MS;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Remove busted players
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat && seat.chips <= 0) {
        // Notify player they're busted (table:busted, NOT table:error)
        seat.socket?.emit('table:busted', { message: 'チップがなくなりました' });
        this.unseatPlayer(seat.odId);
      }
    }
    this.pendingStartHand = false;  // ← ここでリセット
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
