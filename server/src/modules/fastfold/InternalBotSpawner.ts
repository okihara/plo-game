import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import { getCPUAction } from '../../shared/logic/cpuAI.js';
import { GameState, Card, Action, Player, Position, GameAction } from '../../shared/logic/types.js';
import { ClientGameState, OnlinePlayer } from '../../shared/types/websocket.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

const BOT_NAMES = [
  'fill_bot_1', 'fill_bot_2', 'fill_bot_3', 'fill_bot_4', 'fill_bot_5',
  'fill_bot_6', 'fill_bot_7', 'fill_bot_8', 'fill_bot_9', 'fill_bot_10',
];

const BOT_AVATARS = [
  '/images/icons/avatar6.png',
  '/images/icons/avatar7.png',
  '/images/icons/avatar8.png',
  '/images/icons/avatar9.png',
  '/images/icons/avatar10.png',
];

interface InternalBot {
  socket: ClientSocket;
  name: string;
  playerId: string | null;
  tableId: string | null;
  seatNumber: number;
  holeCards: Card[];
  gameState: ClientGameState | null;
  blinds: string;
  handActions: GameAction[];
}

/**
 * サーバー内蔵のBot自動投入システム。
 * 人間プレイヤーがマッチメイキングで待機中のとき、
 * 一定時間後にBotを自動生成してテーブルを埋める。
 */
export class InternalBotSpawner {
  private serverPort: number;
  private activeBots: Map<string, InternalBot> = new Map(); // name -> bot
  private usedNames: Set<string> = new Set();

  constructor(serverPort: number) {
    this.serverPort = serverPort;
  }

  /**
   * 指定ブラインドに対してBot数体を投入する
   */
  async spawnBots(count: number, blinds: string): Promise<void> {
    const toSpawn = Math.min(count, BOT_NAMES.length - this.usedNames.size);
    for (let i = 0; i < toSpawn; i++) {
      try {
        await this.spawnOneBot(blinds);
      } catch (err) {
        console.error('[InternalBotSpawner] Failed to spawn bot:', err);
      }
    }
  }

  private async spawnOneBot(blinds: string): Promise<void> {
    const name = this.getAvailableName();
    if (!name) return;

    const avatarIndex = Math.floor(Math.random() * BOT_AVATARS.length);
    const avatar = BOT_AVATARS[avatarIndex];

    const bot: InternalBot = {
      socket: null as any,
      name,
      playerId: null,
      tableId: null,
      seatNumber: -1,
      holeCards: [],
      gameState: null,
      blinds,
      handActions: [],
    };

    return new Promise((resolve, reject) => {
      const socket = ioClient(`http://localhost:${this.serverPort}`, {
        transports: ['websocket'],
        autoConnect: true,
        auth: {
          isBot: true,
          botName: name,
          botAvatar: avatar,
        },
      });

      bot.socket = socket;

      socket.on('connect', () => {
        console.log(`[InternalBotSpawner] ${name} connected`);
      });

      socket.on('connection:established', (data: { playerId: string }) => {
        bot.playerId = data.playerId;
        this.usedNames.add(name);
        this.activeBots.set(name, bot);

        // マッチメイキングに参加
        socket.emit('matchmaking:join', { blinds });
        resolve();
      });

      socket.on('connect_error', (err) => {
        console.error(`[InternalBotSpawner] ${name} connection error:`, err.message);
        reject(err);
      });

      socket.on('table:joined', (data: { tableId: string; seat: number }) => {
        bot.tableId = data.tableId;
        bot.seatNumber = data.seat;
      });

      socket.on('table:left', () => {
        bot.tableId = null;
        bot.seatNumber = -1;
        // Botは再キュー
        setTimeout(() => {
          if (socket.connected && !bot.tableId) {
            socket.emit('matchmaking:join', { blinds: bot.blinds });
          }
        }, 500);
      });

      socket.on('game:hole_cards', (data: { cards: Card[] }) => {
        bot.holeCards = data.cards;
      });

      socket.on('game:state', (data: { state: ClientGameState }) => {
        bot.gameState = data.state;
      });

      socket.on('game:action_taken', (data: { action: Action; amount: number; seat: number }) => {
        bot.handActions.push({
          playerId: data.seat,
          action: data.action,
          amount: data.amount,
        });
      });

      socket.on('game:action_required', (data: {
        playerId: string;
        validActions: { action: Action; minAmount: number; maxAmount: number }[];
        timeoutMs: number;
      }) => {
        if (data.playerId === bot.playerId) {
          this.handleBotAction(bot, data);
        }
      });

      socket.on('game:hand_complete', () => {
        bot.holeCards = [];
        bot.handActions = [];
      });

      // タイムアウト
      setTimeout(() => {
        if (!bot.playerId) {
          socket.disconnect();
          reject(new Error('Bot connection timeout'));
        }
      }, 10000);
    });
  }

  private handleBotAction(bot: InternalBot, data: {
    validActions: { action: Action; minAmount: number; maxAmount: number }[];
  }): void {
    if (!bot.gameState || bot.holeCards.length === 0) {
      const checkAction = data.validActions.find(a => a.action === 'check');
      if (checkAction) {
        bot.socket.emit('game:action', { action: 'check', amount: 0 });
      } else {
        bot.socket.emit('game:action', { action: 'fold', amount: 0 });
      }
      return;
    }

    const aiGameState = this.buildGameState(bot);
    if (!aiGameState) {
      const checkAction = data.validActions.find(a => a.action === 'check');
      bot.socket.emit('game:action', {
        action: checkAction ? 'check' : 'fold',
        amount: 0,
      });
      return;
    }

    const aiDecision = getCPUAction(aiGameState, bot.seatNumber);

    const validAction = data.validActions.find(a => a.action === aiDecision.action);
    if (validAction) {
      let amount = aiDecision.amount;
      if (aiDecision.action === 'bet' || aiDecision.action === 'raise') {
        amount = Math.max(validAction.minAmount, Math.min(validAction.maxAmount, amount));
      }
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        bot.socket.emit('game:action', { action: aiDecision.action, amount });
      }, delay);
    } else {
      const checkAction = data.validActions.find(a => a.action === 'check');
      const callAction = data.validActions.find(a => a.action === 'call');
      const delay = 800 + Math.random() * 800;
      setTimeout(() => {
        if (checkAction) {
          bot.socket.emit('game:action', { action: 'check', amount: 0 });
        } else if (callAction) {
          bot.socket.emit('game:action', { action: 'call', amount: callAction.minAmount });
        } else {
          bot.socket.emit('game:action', { action: 'fold', amount: 0 });
        }
      }, delay);
    }
  }

  private buildGameState(bot: InternalBot): GameState | null {
    if (!bot.gameState || bot.seatNumber === -1) return null;

    const dealerSeat = bot.gameState.dealerSeat;
    const players: Player[] = [];

    for (let i = 0; i < 6; i++) {
      const onlinePlayer = bot.gameState.players[i];
      if (onlinePlayer) {
        players.push({
          id: i,
          name: onlinePlayer.odName,
          position: POSITIONS[(i - dealerSeat + 6) % 6],
          chips: onlinePlayer.chips,
          holeCards: i === bot.seatNumber ? bot.holeCards : [],
          currentBet: onlinePlayer.currentBet,
          totalBetThisRound: onlinePlayer.currentBet,
          folded: onlinePlayer.folded,
          isAllIn: onlinePlayer.isAllIn,
          hasActed: onlinePlayer.hasActed,
        });
      } else {
        players.push({
          id: i,
          name: 'Empty',
          position: POSITIONS[(i - dealerSeat + 6) % 6],
          chips: 0,
          holeCards: [],
          currentBet: 0,
          totalBetThisRound: 0,
          folded: true,
          isAllIn: false,
          hasActed: true,
        });
      }
    }

    return {
      players,
      deck: [],
      communityCards: bot.gameState.communityCards,
      pot: bot.gameState.pot,
      sidePots: [],
      currentStreet: bot.gameState.currentStreet as any,
      dealerPosition: dealerSeat,
      currentPlayerIndex: bot.seatNumber,
      currentBet: bot.gameState.currentBet,
      minRaise: bot.gameState.minRaise,
      smallBlind: bot.gameState.smallBlind,
      bigBlind: bot.gameState.bigBlind,
      lastRaiserIndex: -1,
      handHistory: bot.handActions,
      isHandComplete: false,
      winners: [],
    };
  }

  private getAvailableName(): string | null {
    for (const name of BOT_NAMES) {
      if (!this.usedNames.has(name)) return name;
    }
    return null;
  }

  /** アクティブなBot数 */
  get botCount(): number {
    return this.activeBots.size;
  }

  /** 全Botを切断 */
  disconnectAll(): void {
    for (const bot of this.activeBots.values()) {
      bot.socket.disconnect();
    }
    this.activeBots.clear();
    this.usedNames.clear();
  }
}
