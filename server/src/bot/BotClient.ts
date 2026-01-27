import { io, Socket } from 'socket.io-client';
import { getCPUAction } from '../shared/logic/cpuAI.js';
import { GameState, Card, Action, Player, Position } from '../shared/logic/types.js';
import { ClientGameState, OnlinePlayer } from '../../../shared/types/websocket.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

interface BotConfig {
  serverUrl: string;
  name: string;
  avatarUrl: string | null;
}

export class BotClient {
  private socket: Socket | null = null;
  private playerId: string | null = null;
  private holeCards: Card[] = [];
  private gameState: ClientGameState | null = null;
  private seatNumber: number = -1;
  private config: BotConfig;
  private isConnected = false;
  private tableId: string | null = null;

  constructor(config: BotConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        auth: {
          isBot: true,
          botName: this.config.name,
          botAvatar: this.config.avatarUrl,
        },
      });

      this.socket.on('connect', () => {
        console.log(`[${this.config.name}] Connected to server`);
        this.isConnected = true;
      });

      this.socket.on('connection:established', (data: { playerId: string }) => {
        this.playerId = data.playerId;
        console.log(`[${this.config.name}] Authenticated as ${this.playerId}`);
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        console.error(`[${this.config.name}] Connection error:`, err.message);
        reject(err);
      });

      this.socket.on('disconnect', () => {
        console.log(`[${this.config.name}] Disconnected from server`);
        this.isConnected = false;
        this.tableId = null;
        this.seatNumber = -1;
      });

      // Game events
      this.socket.on('table:joined', (data: { tableId: string; seat: number }) => {
        this.tableId = data.tableId;
        this.seatNumber = data.seat;
        console.log(`[${this.config.name}] Joined table ${data.tableId} at seat ${data.seat}`);
      });

      this.socket.on('table:left', () => {
        console.log(`[${this.config.name}] Left table`);
        this.tableId = null;
        this.seatNumber = -1;
      });

      this.socket.on('table:error', (data: { message: string }) => {
        console.log(`[${this.config.name}] Table error: ${data.message}`);
      });

      this.socket.on('game:hole_cards', (data: { cards: Card[] }) => {
        this.holeCards = data.cards;
        console.log(`[${this.config.name}] Received hole cards`);
      });

      this.socket.on('game:state', (data: { state: ClientGameState }) => {
        this.gameState = data.state;
      });

      this.socket.on('game:action_required', (data: {
        playerId: string;
        validActions: { action: Action; minAmount: number; maxAmount: number }[];
        timeoutMs: number;
      }) => {
        if (data.playerId === this.playerId) {
          this.handleActionRequired(data);
        }
      });

      this.socket.on('game:hand_complete', () => {
        // Reset for next hand
        this.holeCards = [];
      });

      this.socket.on('fastfold:queued', (data: { position: number }) => {
        console.log(`[${this.config.name}] Queued in Fast Fold pool (position: ${data.position})`);
      });

      this.socket.on('fastfold:table_assigned', (data: { tableId: string }) => {
        console.log(`[${this.config.name}] Assigned to Fast Fold table ${data.tableId}`);
      });

      // Timeout for connection
      setTimeout(() => {
        if (!this.playerId) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  private handleActionRequired(data: {
    playerId: string;
    validActions: { action: Action; minAmount: number; maxAmount: number }[];
    timeoutMs: number;
  }): void {
    if (!this.gameState || this.holeCards.length === 0) {
      // Fallback: just check or fold
      const checkAction = data.validActions.find(a => a.action === 'check');
      if (checkAction) {
        this.sendAction('check', 0);
      } else {
        this.sendAction('fold', 0);
      }
      return;
    }

    // Build GameState for AI
    const aiGameState = this.buildGameStateForAI();
    if (!aiGameState) {
      const checkAction = data.validActions.find(a => a.action === 'check');
      if (checkAction) {
        this.sendAction('check', 0);
      } else {
        this.sendAction('fold', 0);
      }
      return;
    }

    // Get AI decision
    const aiDecision = getCPUAction(aiGameState, this.seatNumber);

    // Validate action against valid actions
    const validAction = data.validActions.find(a => a.action === aiDecision.action);
    if (validAction) {
      // Clamp amount to valid range
      let amount = aiDecision.amount;
      if (aiDecision.action === 'bet' || aiDecision.action === 'raise') {
        amount = Math.max(validAction.minAmount, Math.min(validAction.maxAmount, amount));
      }

      // Add thinking delay (800-2000ms)
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        this.sendAction(aiDecision.action, amount);
      }, delay);
    } else {
      // Fallback: check or fold
      const checkAction = data.validActions.find(a => a.action === 'check');
      const callAction = data.validActions.find(a => a.action === 'call');

      if (checkAction) {
        setTimeout(() => this.sendAction('check', 0), 800);
      } else if (callAction) {
        setTimeout(() => this.sendAction('call', callAction.minAmount), 800);
      } else {
        setTimeout(() => this.sendAction('fold', 0), 800);
      }
    }
  }

  private buildGameStateForAI(): GameState | null {
    if (!this.gameState || this.seatNumber === -1) return null;

    const players: Player[] = [];
    let dealerPosition = this.gameState.dealerSeat;

    for (let i = 0; i < 6; i++) {
      const onlinePlayer = this.gameState.players[i];
      if (onlinePlayer) {
        players.push({
          id: i,
          name: onlinePlayer.odName,
          position: POSITIONS[(i - dealerPosition + 6) % 6],
          chips: onlinePlayer.chips,
          holeCards: i === this.seatNumber ? this.holeCards : [],
          currentBet: onlinePlayer.currentBet,
          totalBetThisRound: onlinePlayer.currentBet,
          folded: onlinePlayer.folded,
          isAllIn: onlinePlayer.isAllIn,
          isHuman: onlinePlayer.odIsHuman,
          hasActed: onlinePlayer.hasActed,
        });
      } else {
        // Empty seat - create placeholder
        players.push({
          id: i,
          name: 'Empty',
          position: POSITIONS[(i - dealerPosition + 6) % 6],
          chips: 0,
          holeCards: [],
          currentBet: 0,
          totalBetThisRound: 0,
          folded: true,
          isAllIn: false,
          isHuman: false,
          hasActed: true,
        });
      }
    }

    return {
      players,
      deck: [],
      communityCards: this.gameState.communityCards,
      pot: this.gameState.pot,
      sidePots: [],
      currentStreet: this.gameState.currentStreet as any,
      dealerPosition: this.gameState.dealerSeat,
      currentPlayerIndex: this.seatNumber,
      currentBet: this.gameState.currentBet,
      minRaise: this.gameState.minRaise,
      smallBlind: this.gameState.smallBlind,
      bigBlind: this.gameState.bigBlind,
      lastRaiserIndex: -1,
      handHistory: [],
      isHandComplete: false,
      winners: [],
    };
  }

  private sendAction(action: Action, amount: number): void {
    if (!this.socket || !this.isConnected) return;

    console.log(`[${this.config.name}] Action: ${action}${amount > 0 ? ` $${amount}` : ''}`);
    this.socket.emit('game:action', { action, amount });
  }

  async joinFastFoldPool(blinds: string): Promise<void> {
    if (!this.socket || !this.isConnected) {
      throw new Error('Not connected to server');
    }

    console.log(`[${this.config.name}] Joining Fast Fold pool (${blinds})`);
    this.socket.emit('fastfold:join', { blinds });
  }

  async leaveFastFoldPool(blinds: string): Promise<void> {
    if (!this.socket) return;
    this.socket.emit('fastfold:leave', { blinds });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.isConnected = false;
    this.playerId = null;
    this.tableId = null;
    this.seatNumber = -1;
    this.holeCards = [];
    this.gameState = null;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  getName(): string {
    return this.config.name;
  }

  isActive(): boolean {
    return this.isConnected && this.socket !== null;
  }

  isInGame(): boolean {
    return this.tableId !== null && this.seatNumber !== -1;
  }
}
