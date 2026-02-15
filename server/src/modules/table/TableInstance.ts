import { Server, Socket } from 'socket.io';
import { GameState, Action, Card, Player } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, applyAction, getValidActions, getActivePlayers, determineWinner } from '../../shared/logic/gameEngine.js';
import { OnlinePlayer, ClientGameState } from '../../shared/types/websocket.js';
import { nanoid } from 'nanoid';

interface SeatInfo {
  odId: string;
  odName: string;
  avatarId: number;
  avatarUrl: string | null;  // Twitter/OAuth profile image URL
  socket: Socket | null;
  chips: number;
  buyIn: number;
  waitingForNextHand: boolean; // ハンド中に着席した場合、次のハンドから参加
}

// ダッシュボード用：送信メッセージログ
export interface MessageLog {
  timestamp: number;
  event: string;
  target: 'all' | string; // 'all' = broadcast, string = playerId
  data: unknown;
}

// ダッシュボード用：待機中のアクションリクエスト
export interface PendingAction {
  playerId: string;
  playerName: string;
  seatNumber: number;
  validActions: { action: string; minAmount: number; maxAmount: number }[];
  requestedAt: number;
  timeoutMs: number;
}

export class TableInstance {
  public readonly id: string;
  public readonly blinds: string;
  public readonly smallBlind: number;
  public readonly bigBlind: number;
  public readonly maxPlayers: number = 6;
  public isFastFold: boolean = false;

  private seats: (SeatInfo | null)[] = Array(6).fill(null);
  private gameState: GameState | null = null;
  private io: Server;
  private actionTimer: NodeJS.Timeout | null = null;
  private streetTransitionTimer: NodeJS.Timeout | null = null;
  private runOutTimer: NodeJS.Timeout | null = null;
  private isRunOutInProgress = false;
  private readonly ACTION_TIMEOUT_MS = 10000;
  private readonly STREET_TRANSITION_DELAY_MS = 1500;
  private readonly HAND_COMPLETE_DELAY_MS = 3500; // 通常のハンド完了（全員フォールド等）
  private readonly SHOWDOWN_DELAY_MS = 5000; // ショーダウン時（カードを見る時間）
  private readonly RUNOUT_STREET_DELAY_MS = 1500; // オールイン時の各ストリート表示間隔
  private isHandInProgress = false;
  private pendingStartHand = false;

  // ダッシュボード用トラッキング
  private messageLog: MessageLog[] = [];
  private readonly MAX_MESSAGE_LOG = 50; // 直近50件を保持
  private pendingAction: PendingAction | null = null;

  constructor(io: Server, blinds: string = '1/3', isFastFold: boolean = false) {
    this.id = nanoid(12);
    this.blinds = blinds;
    this.isFastFold = isFastFold;
    this.io = io;

    const [sb, bb] = blinds.split('/').map(Number);
    this.smallBlind = sb;
    this.bigBlind = bb;
  }

  // Get room name for this table
  private get roomName() {
    return `table:${this.id}`;
  }

  // ダッシュボード用：メッセージをログに記録
  private logMessage(event: string, target: 'all' | string, data: unknown): void {
    this.messageLog.push({
      timestamp: Date.now(),
      event,
      target,
      data,
    });
    // 古いログを削除
    if (this.messageLog.length > this.MAX_MESSAGE_LOG) {
      this.messageLog.shift();
    }
  }

  // ダッシュボード用：ゲーム状態詳細を取得
  public getDebugState(): {
    messageLog: MessageLog[];
    pendingAction: PendingAction | null;
    gamePhase: string;
  } {
    return {
      messageLog: this.messageLog,
      pendingAction: this.pendingAction,
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
    // Find available seat
    let seatIndex = preferredSeat ?? -1;

    if (seatIndex >= 0 && seatIndex < 6 && this.seats[seatIndex] === null) {
      // Preferred seat is available
    } else {
      // Find first available seat
      seatIndex = this.seats.findIndex(s => s === null);
    }

    if (seatIndex === -1) return null;

    // ランダムなアバターIDを割り当て (0-14) - avatarUrlがない場合のフォールバック用
    const avatarId = Math.floor(Math.random() * 15);

    this.seats[seatIndex] = {
      odId,
      odName,
      avatarId,
      avatarUrl: avatarUrl ?? null,
      socket,
      chips: buyIn,
      buyIn,
      waitingForNextHand: this.isHandInProgress, // ハンド中に着席した場合は次のハンドから参加
    };

    socket.join(this.roomName);

    // Broadcast player joined
    const joinData = {
      seat: seatIndex,
      player: this.getOnlinePlayer(seatIndex)!,
    };
    this.io.to(this.roomName).emit('table:player_joined', joinData);
    this.logMessage('table:player_joined', 'all', joinData);

    // Send current table state to the newly seated player
    // This allows them to see the table immediately while waiting for more players
    const clientState = this.getClientGameState();
    socket.emit('game:state', { state: clientState });
    this.logMessage('game:state', odId, { street: clientState.currentStreet, pot: clientState.pot });

    // Start hand if enough players
    this.maybeStartHand();

    return seatIndex;
  }

  // Remove a player from the table
  public unseatPlayer(odId: string): void {
    const seatIndex = this.seats.findIndex(s => s?.odId === odId);
    if (seatIndex === -1) return;

    const seat = this.seats[seatIndex];
    if (seat?.socket) {
      // プレイヤーにテーブルを離れたことを通知
      seat.socket.emit('table:left');
      seat.socket.leave(this.roomName);
    }

    // Check if this player was the one we're waiting for action
    const wasCurrentPlayer = this.gameState &&
      !this.gameState.isHandComplete &&
      this.gameState.currentPlayerIndex === seatIndex;

    this.seats[seatIndex] = null;

    const leftData = { seat: seatIndex, odId };
    this.io.to(this.roomName).emit('table:player_left', leftData);
    this.logMessage('table:player_left', 'all', leftData);

    // If in a hand, fold the player directly (not via handleAction since seat is already null)
    if (this.gameState && !this.gameState.isHandComplete) {
      const player = this.gameState.players[seatIndex];
      if (player && !player.folded) {
        // Directly fold the player in game state
        player.folded = true;

        // Broadcast the fold action
        const foldData = { playerId: odId, action: 'fold', amount: 0 };
        this.io.to(this.roomName).emit('game:action_taken', foldData);
        this.logMessage('game:action_taken', 'all', foldData);

        // If this player was the current player, clear timer and advance
        if (wasCurrentPlayer) {
          if (this.actionTimer) {
            clearTimeout(this.actionTimer);
            this.actionTimer = null;
          }
          this.pendingAction = null;

          // Advance to next player or complete hand
          this.advanceToNextPlayer();
        }
      }
    }
  }

  // Advance game to next player after a fold
  private advanceToNextPlayer(): void {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) return;

    // Find next active player
    const activePlayers = getActivePlayers(this.gameState);

    // If only one player left, they win
    if (activePlayers.length <= 1) {
      this.gameState = determineWinner(this.gameState);
      this.broadcastGameState();
      this.handleHandComplete();
      return;
    }

    // Find next player who can act
    let nextIndex = (this.gameState.currentPlayerIndex + 1) % 6;
    let attempts = 0;
    while (attempts < 6) {
      const player = this.gameState.players[nextIndex];
      const seat = this.seats[nextIndex];
      // waitingForNextHandのプレイヤーはスキップ
      if (player && !player.folded && !player.isAllIn && seat && !seat.waitingForNextHand) {
        break;
      }
      nextIndex = (nextIndex + 1) % 6;
      attempts++;
    }

    if (attempts >= 6) {
      // No more players can act - run out board and determine winner
      this.gameState = determineWinner(this.gameState);
      this.broadcastGameState();
      this.handleHandComplete();
      return;
    }

    this.gameState.currentPlayerIndex = nextIndex;
    this.requestNextAction();
    this.broadcastGameState();
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) return false;

    const seatIndex = this.seats.findIndex(s => s?.odId === odId);
    if (seatIndex === -1) return false;

    // Check if it's this player's turn
    if (this.gameState.currentPlayerIndex !== seatIndex) return false;

    // Validate action
    const validActions = getValidActions(this.gameState, seatIndex);
    const isValid = validActions.some(a =>
      a.action === action &&
      (action === 'fold' || action === 'check' || (amount >= a.minAmount && amount <= a.maxAmount))
    );

    if (!isValid) return false;

    // Clear action timer and pending action
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.pendingAction = null;

    // ストリート変更・ランアウト検出用に現在の状態を保存
    const previousStreet = this.gameState.currentStreet;
    const previousCardCount = this.gameState.communityCards.length;

    // Apply action
    this.gameState = applyAction(this.gameState, seatIndex, action, amount);

    // Broadcast action
    const actionData = { playerId: odId, action, amount };
    this.io.to(this.roomName).emit('game:action_taken', actionData);
    this.logMessage('game:action_taken', 'all', actionData);

    // Check if hand is complete
    if (this.gameState.isHandComplete) {
      const finalCardCount = this.gameState.communityCards.length;
      if (finalCardCount > previousCardCount) {
        // オールインでのランアウト: ストリートごとに段階的にカードを表示
        this.handleAllInRunOut(this.gameState, previousCardCount);
      } else {
        // 通常のハンド完了（全員フォールド or リバーベッティング終了）
        this.broadcastGameState();
        this.handleHandComplete();
      }
    } else {
      // ストリートが変わった場合は遅延後に次のアクションを要求
      const streetChanged = this.gameState.currentStreet !== previousStreet;
      if (streetChanged) {
        // コミュニティカードを即座に表示
        this.broadcastGameState();
        // プレイヤーがカードを確認できるよう遅延後に次のアクションを要求
        this.streetTransitionTimer = setTimeout(() => {
          this.streetTransitionTimer = null;
          this.requestNextAction();
        }, this.STREET_TRANSITION_DELAY_MS);
      } else {
        // Request next action then broadcast (so pendingAction is set)
        this.requestNextAction();
        this.broadcastGameState();
      }
    }

    return true;
  }

  // Handle fast fold
  public handleFastFold(odId: string): void {
    if (!this.isFastFold) return;

    const seatIndex = this.seats.findIndex(s => s?.odId === odId);
    if (seatIndex === -1) return;

    if (this.gameState && !this.gameState.isHandComplete) {
      // Fold the player
      if (this.gameState.currentPlayerIndex === seatIndex) {
        this.handleAction(odId, 'fold', 0);
      } else {
        // Pre-fold (mark for folding when turn comes)
        // For now, just regular fold
        const player = this.gameState.players[seatIndex];
        if (player && !player.folded) {
          player.folded = true;
          const foldData = { playerId: odId, action: 'fold', amount: 0 };
          this.io.to(this.roomName).emit('game:action_taken', foldData);
          this.logMessage('game:action_taken', 'all', foldData);
        }
      }
    }

    // Emit event for MatchmakingPool to handle re-queuing
    const seat = this.seats[seatIndex];
    if (seat?.socket) {
      seat.socket.emit('matchmaking:ready_for_new_table');
      this.logMessage('matchmaking:ready_for_new_table', odId, {});
    }
  }

  // Get the number of connected players
  public getConnectedPlayerCount(): number {
    return this.seats.filter(s => s?.socket?.connected).length;
  }

  // Get total player count
  public getPlayerCount(): number {
    return this.seats.filter(s => s !== null).length;
  }

  // Check if table has available seats
  public hasAvailableSeat(): boolean {
    return this.seats.some(s => s === null);
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

  private maybeStartHand(wasShowdown: boolean = false): void {
    if (this.isHandInProgress || this.pendingStartHand) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < 2) return;

    this.pendingStartHand = true;

    // ショーダウン時はカードを確認する時間を長めに取る
    const delay = wasShowdown ? this.SHOWDOWN_DELAY_MS : this.HAND_COMPLETE_DELAY_MS;
    setTimeout(() => {
      this.startNewHand();
      this.pendingStartHand = false;
    }, delay);
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
    const buyInChips = this.bigBlind * 200;
    this.gameState = createInitialGameState(buyInChips);
    this.gameState.smallBlind = this.smallBlind;
    this.gameState.bigBlind = this.bigBlind;

    // Restore dealer position (startNewHand will increment it)
    if (previousDealerPosition >= 0) {
      this.gameState.dealerPosition = previousDealerPosition;
    }

    // Sync chips from seats to game state (before startNewHand)
    // Also clear waitingForNextHand flag for all players
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      if (seat) {
        // 新しいハンド開始時にwaitingForNextHandフラグをクリア
        seat.waitingForNextHand = false;
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
    for (let i = 0; i < 6; i++) {
      if (!this.seats[i]) {
        this.gameState.players[i].folded = true;
        this.gameState.players[i].hasActed = true;
      }
    }

    // Send hole cards to each player (human and bot)
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      if (seat?.socket) {
        const holeCardsData = { cards: this.gameState.players[i].holeCards };
        seat.socket.emit('game:hole_cards', holeCardsData);
        this.logMessage('game:hole_cards', seat.odId, { cardCount: holeCardsData.cards.length });
      }
    }

    // Request first action then broadcast (so pendingAction is set)
    this.requestNextAction();
    this.broadcastGameState();
  }

  private requestNextAction(): void {
    if (!this.gameState || this.gameState.isHandComplete) return;

    const currentPlayerIndex = this.gameState.currentPlayerIndex;

    // currentPlayerIndex が -1 の場合（全員オールインなど）はハンド完了処理へ
    if (currentPlayerIndex === -1) {
      this.handleHandComplete();
      return;
    }

    const currentSeat = this.seats[currentPlayerIndex];

    if (!currentSeat || !currentSeat.socket) {
      // No socket means player disconnected - fold and advance
      const player = this.gameState.players[currentPlayerIndex];
      if (player && !player.folded) {
        player.folded = true;
        const foldData = { playerId: currentSeat?.odId || `seat_${currentPlayerIndex}`, action: 'fold', amount: 0 };
        this.io.to(this.roomName).emit('game:action_taken', foldData);
        this.logMessage('game:action_taken', 'all', foldData);
      }
      this.advanceToNextPlayer();
      return;
    }

    const validActions = getValidActions(this.gameState, currentPlayerIndex);

    // Set pending action for dashboard
    this.pendingAction = {
      playerId: currentSeat.odId,
      playerName: currentSeat.odName,
      seatNumber: currentPlayerIndex,
      validActions: validActions.map(a => ({
        action: a.action,
        minAmount: a.minAmount,
        maxAmount: a.maxAmount,
      })),
      requestedAt: Date.now(),
      timeoutMs: this.ACTION_TIMEOUT_MS,
    };

    // Send action request (works for both human players and bots)
    const actionRequiredData = {
      playerId: currentSeat.odId,
      validActions,
      timeoutMs: this.ACTION_TIMEOUT_MS,
    };
    currentSeat.socket.emit('game:action_required', actionRequiredData);
    this.logMessage('game:action_required', currentSeat.odId, actionRequiredData);

    // Set action timer - auto-fold on timeout
    const playerIdForTimeout = currentSeat.odId;
    const seatIndexForTimeout = currentPlayerIndex;
    this.actionTimer = setTimeout(() => {
      // Check if player is still at the table
      const seat = this.seats[seatIndexForTimeout];
      if (seat && seat.odId === playerIdForTimeout) {
        // Player still there, force fold via handleAction
        this.handleAction(playerIdForTimeout, 'fold', 0);
      } else {
        // Player already left, but game might be stuck - advance if needed
        if (this.gameState &&
            !this.gameState.isHandComplete &&
            this.gameState.currentPlayerIndex === seatIndexForTimeout) {
          // Game is stuck waiting for this player, advance
          const player = this.gameState.players[seatIndexForTimeout];
          if (player && !player.folded) {
            player.folded = true;
          }
          this.pendingAction = null;
          this.advanceToNextPlayer();
        }
      }
    }, this.ACTION_TIMEOUT_MS);
  }

  /**
   * オールイン時のランアウト: コミュニティカードをストリートごとに段階的に表示する
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
    let currentStageIndex = 0;

    const revealNextStage = () => {
      this.runOutTimer = null;

      if (currentStageIndex >= stages.length) {
        // 全カード表示完了 → 最終結果を表示
        this.isRunOutInProgress = false;
        this.gameState = finalState;
        this.broadcastGameState();
        this.handleHandComplete();
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
      this.runOutTimer = setTimeout(revealNextStage, this.RUNOUT_STREET_DELAY_MS);
    };

    // 最初のステージを即座に表示開始
    revealNextStage();
  }

  private handleHandComplete(): void {
    if (!this.gameState) return;

    // Clear pending action
    this.pendingAction = null;

    // Broadcast winners
    const handCompleteData = {
      winners: this.gameState.winners.map(w => ({
        playerId: this.seats[w.playerId]?.odId || '',
        amount: w.amount,
        handName: w.handName,
      })),
    };
    this.io.to(this.roomName).emit('game:hand_complete', handCompleteData);
    this.logMessage('game:hand_complete', 'all', handCompleteData);

    // Showdown - reveal cards
    if (this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1) {
      const showdownData = {
        winners: this.gameState.winners.map(w => ({
          playerId: this.seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: this.gameState!.players[w.playerId].holeCards,
        })),
      };
      this.io.to(this.roomName).emit('game:showdown', showdownData);
      this.logMessage('game:showdown', 'all', showdownData);
    }

    // Update seat chips
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      // waitingForNextHandのプレイヤーはハンドに参加していないのでチップを上書きしない
      if (seat && this.gameState.players[i] && !seat.waitingForNextHand) {
        seat.chips = this.gameState.players[i].chips;
      }
    }

    this.isHandInProgress = false;

    // ショーダウンかどうかを記録（次ハンド開始までの待ち時間に影響）
    const wasShowdown = this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1;

    // Remove busted players
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      if (seat && seat.chips <= 0) {
        // Notify player they're busted
        seat.socket?.emit('table:error', { message: 'You have run out of chips!' });
        this.unseatPlayer(seat.odId);
      }
    }

    // Start next hand if enough players
    this.maybeStartHand(wasShowdown);
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;

    const clientState = this.getClientGameState();
    this.io.to(this.roomName).emit('game:state', { state: clientState });
    this.logMessage('game:state', 'all', { street: clientState.currentStreet, pot: clientState.pot });
  }

  public getClientGameState(): ClientGameState {
    // タイムアウト情報を計算
    const actionTimeoutAt = this.pendingAction
      ? this.pendingAction.requestedAt + this.pendingAction.timeoutMs
      : null;
    const actionTimeoutMs = this.pendingAction?.timeoutMs ?? null;

    if (!this.gameState) {
      return {
        tableId: this.id,
        players: this.seats.map((_, i) => this.getOnlinePlayer(i)),
        communityCards: [],
        pot: 0,
        sidePots: [],
        currentStreet: 'preflop',
        dealerSeat: 0,
        currentPlayerSeat: null,
        currentBet: 0,
        minRaise: this.bigBlind,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        isHandInProgress: false,
        actionTimeoutAt: null,
        actionTimeoutMs: null,
      };
    }

    return {
      tableId: this.id,
      players: this.seats.map((seat, i) => {
        if (!seat) return null;
        const player = this.gameState!.players[i];
        // waitingForNextHandのプレイヤーはハンドに参加していない状態で表示
        if (seat.waitingForNextHand) {
          return {
            odId: seat.odId,
            odName: seat.odName,
            avatarId: seat.avatarId,
            avatarUrl: seat.avatarUrl,
            seatNumber: i,
            chips: seat.chips, // buyIn時のチップを表示
            currentBet: 0,
            folded: true, // 参加していないのでfolded扱い
            isAllIn: false,
            hasActed: true,
            isConnected: seat.socket?.connected ?? false,
          };
        }
        return {
          odId: seat.odId,
          odName: seat.odName,
          avatarId: seat.avatarId,
          avatarUrl: seat.avatarUrl,
          seatNumber: i,
          chips: player?.chips ?? seat.chips,
          currentBet: player?.currentBet ?? 0,
          folded: player?.folded ?? false,
          isAllIn: player?.isAllIn ?? false,
          hasActed: player?.hasActed ?? false,
          isConnected: seat.socket?.connected ?? false,
        };
      }),
      communityCards: this.gameState.communityCards,
      pot: this.gameState.pot,
      sidePots: (this.gameState.sidePots || []).map(sp => ({
        amount: sp.amount,
        eligiblePlayerSeats: sp.eligiblePlayers,
      })),
      currentStreet: this.gameState.currentStreet,
      dealerSeat: this.gameState.dealerPosition,
      currentPlayerSeat: this.gameState.isHandComplete ? null : this.gameState.currentPlayerIndex,
      currentBet: this.gameState.currentBet,
      minRaise: this.gameState.minRaise,
      smallBlind: this.gameState.smallBlind,
      bigBlind: this.gameState.bigBlind,
      isHandInProgress: this.isHandInProgress,
      actionTimeoutAt,
      actionTimeoutMs,
    };
  }

  private getOnlinePlayer(seatIndex: number): OnlinePlayer | null {
    const seat = this.seats[seatIndex];
    if (!seat) return null;

    const player = this.gameState?.players[seatIndex];

    // waitingForNextHandのプレイヤーはハンドに参加していない状態で表示
    if (seat.waitingForNextHand) {
      return {
        odId: seat.odId,
        odName: seat.odName,
        avatarId: seat.avatarId,
        avatarUrl: seat.avatarUrl,
        seatNumber: seatIndex,
        chips: seat.chips,
        currentBet: 0,
        folded: true,
        isAllIn: false,
        hasActed: true,
        isConnected: seat.socket?.connected ?? false,
      };
    }

    return {
      odId: seat.odId,
      odName: seat.odName,
      avatarId: seat.avatarId,
      avatarUrl: seat.avatarUrl,
      seatNumber: seatIndex,
      chips: player?.chips ?? seat.chips,
      currentBet: player?.currentBet ?? 0,
      folded: player?.folded ?? false,
      isAllIn: player?.isAllIn ?? false,
      hasActed: player?.hasActed ?? false,
      isConnected: seat.socket?.connected ?? false,
    };
  }
}
