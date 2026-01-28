import { Server, Socket } from 'socket.io';
import { GameState, Action, Card, Player } from '../../shared/logic/types.js';
import { createInitialGameState, startNewHand, applyAction, getValidActions, getActivePlayers } from '../../shared/logic/gameEngine.js';
import { OnlinePlayer, ClientGameState } from '../../../../shared/types/websocket.js';
import { nanoid } from 'nanoid';

interface SeatInfo {
  odId: string;
  odName: string;
  odAvatarUrl: string | null;
  odIsHuman: boolean;
  socket: Socket | null;
  chips: number;
  buyIn: number;
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
  private readonly ACTION_TIMEOUT_MS = 30000;
  private isHandInProgress = false;
  private pendingStartHand = false;

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

  // Add a player to the table
  public seatPlayer(
    odId: string,
    odName: string,
    odAvatarUrl: string | null,
    socket: Socket,
    buyIn: number,
    preferredSeat?: number,
    isBot: boolean = false
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

    this.seats[seatIndex] = {
      odId,
      odName,
      odAvatarUrl,
      odIsHuman: !isBot, // Bots are not human
      socket,
      chips: buyIn,
      buyIn,
    };

    socket.join(this.roomName);

    // Broadcast player joined
    this.io.to(this.roomName).emit('table:player_joined', {
      seat: seatIndex,
      player: this.getOnlinePlayer(seatIndex)!,
    });

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
      seat.socket.leave(this.roomName);
    }

    this.seats[seatIndex] = null;

    this.io.to(this.roomName).emit('table:player_left', {
      seat: seatIndex,
      odId,
    });

    // If in a hand, fold the player
    if (this.gameState && !this.gameState.isHandComplete) {
      const player = this.gameState.players[seatIndex];
      if (player && !player.folded) {
        this.handleAction(odId, 'fold', 0);
      }
    }
  }

  // Handle player action
  public handleAction(odId: string, action: Action, amount: number): boolean {
    if (!this.gameState || this.gameState.isHandComplete) return false;

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

    // Clear action timer
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }

    // Apply action
    this.gameState = applyAction(this.gameState, seatIndex, action, amount);

    // Broadcast action
    this.io.to(this.roomName).emit('game:action_taken', {
      playerId: odId,
      action,
      amount,
    });

    // Check for street change
    this.broadcastGameState();

    // Check if hand is complete
    if (this.gameState.isHandComplete) {
      this.handleHandComplete();
    } else {
      // Request next action
      this.requestNextAction();
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
          this.io.to(this.roomName).emit('game:action_taken', {
            playerId: odId,
            action: 'fold',
            amount: 0,
          });
        }
      }
    }

    // Emit event for FastFoldPool to handle re-queuing
    const seat = this.seats[seatIndex];
    if (seat?.socket) {
      seat.socket.emit('fastfold:ready_for_new_table');
    }
  }

  // Get the number of human players
  public getHumanPlayerCount(): number {
    return this.seats.filter(s => s?.odIsHuman).length;
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

  private maybeStartHand(): void {
    if (this.isHandInProgress || this.pendingStartHand) return;

    const playerCount = this.getPlayerCount();
    if (playerCount < 2) return;

    this.pendingStartHand = true;

    // Delay before starting new hand
    setTimeout(() => {
      this.startNewHand();
      this.pendingStartHand = false;
    }, 2000);
  }

  private startNewHand(): void {
    if (this.isHandInProgress) return;

    this.isHandInProgress = true;

    // Create initial game state
    const buyInChips = this.bigBlind * 200;
    this.gameState = createInitialGameState(buyInChips);
    this.gameState.smallBlind = this.smallBlind;
    this.gameState.bigBlind = this.bigBlind;

    // Sync chips from seats to game state (before startNewHand)
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      if (seat) {
        this.gameState.players[i].chips = seat.chips;
        this.gameState.players[i].name = seat.odName;
        this.gameState.players[i].isHuman = seat.odIsHuman;
      } else {
        // 空席のプレイヤーはチップ0にしてゲームに参加させない
        this.gameState.players[i].chips = 0;
      }
    }

    // Start the hand
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
        seat.socket.emit('game:hole_cards', {
          cards: this.gameState.players[i].holeCards,
        });
      }
    }

    // Broadcast game state
    this.broadcastGameState();

    // Request first action
    this.requestNextAction();
  }

  private requestNextAction(): void {
    if (!this.gameState || this.gameState.isHandComplete) return;

    const currentPlayerIndex = this.gameState.currentPlayerIndex;
    const currentSeat = this.seats[currentPlayerIndex];

    if (!currentSeat || !currentSeat.socket) {
      // No socket means player disconnected - auto-fold
      if (currentSeat) {
        this.handleAction(currentSeat.odId, 'fold', 0);
      }
      return;
    }

    const validActions = getValidActions(this.gameState, currentPlayerIndex);

    // Send action request (works for both human players and bots)
    currentSeat.socket.emit('game:action_required', {
      playerId: currentSeat.odId,
      validActions,
      timeoutMs: this.ACTION_TIMEOUT_MS,
    });

    // Set action timer - auto-fold on timeout
    this.actionTimer = setTimeout(() => {
      this.handleAction(currentSeat.odId, 'fold', 0);
    }, this.ACTION_TIMEOUT_MS);
  }

  private handleHandComplete(): void {
    if (!this.gameState) return;

    // Broadcast winners
    this.io.to(this.roomName).emit('game:hand_complete', {
      winners: this.gameState.winners.map(w => ({
        playerId: this.seats[w.playerId]?.odId || '',
        amount: w.amount,
        handName: w.handName,
      })),
    });

    // Showdown - reveal cards
    if (this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1) {
      const showdownPlayers = getActivePlayers(this.gameState);
      this.io.to(this.roomName).emit('game:showdown', {
        winners: this.gameState.winners.map(w => ({
          playerId: this.seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: this.gameState!.players[w.playerId].holeCards,
        })),
      });
    }

    // Update seat chips
    for (let i = 0; i < 6; i++) {
      const seat = this.seats[i];
      if (seat && this.gameState.players[i]) {
        seat.chips = this.gameState.players[i].chips;
      }
    }

    this.isHandInProgress = false;

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
    this.maybeStartHand();
  }

  private broadcastGameState(): void {
    if (!this.gameState) return;

    const clientState = this.getClientGameState();
    this.io.to(this.roomName).emit('game:state', { state: clientState });
  }

  public getClientGameState(): ClientGameState {
    if (!this.gameState) {
      return {
        tableId: this.id,
        players: this.seats.map((_, i) => this.getOnlinePlayer(i)),
        communityCards: [],
        pot: 0,
        currentStreet: 'preflop',
        dealerSeat: 0,
        currentPlayerSeat: null,
        currentBet: 0,
        minRaise: this.bigBlind,
        smallBlind: this.smallBlind,
        bigBlind: this.bigBlind,
        isHandInProgress: false,
      };
    }

    return {
      tableId: this.id,
      players: this.seats.map((seat, i) => {
        if (!seat) return null;
        const player = this.gameState!.players[i];
        return {
          odId: seat.odId,
          odName: seat.odName,
          odAvatarUrl: seat.odAvatarUrl,
          odIsHuman: seat.odIsHuman,
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
      currentStreet: this.gameState.currentStreet,
      dealerSeat: this.gameState.dealerPosition,
      currentPlayerSeat: this.gameState.isHandComplete ? null : this.gameState.currentPlayerIndex,
      currentBet: this.gameState.currentBet,
      minRaise: this.gameState.minRaise,
      smallBlind: this.gameState.smallBlind,
      bigBlind: this.gameState.bigBlind,
      isHandInProgress: this.isHandInProgress,
    };
  }

  private getOnlinePlayer(seatIndex: number): OnlinePlayer | null {
    const seat = this.seats[seatIndex];
    if (!seat) return null;

    const player = this.gameState?.players[seatIndex];

    return {
      odId: seat.odId,
      odName: seat.odName,
      odAvatarUrl: seat.odAvatarUrl,
      odIsHuman: seat.odIsHuman,
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
