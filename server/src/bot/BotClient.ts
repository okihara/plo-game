import { io, Socket } from 'socket.io-client';
import { getCPUAction } from '../shared/logic/cpuAI.js';
import { GameState, Card, Action, Player, Position, GameAction } from '../shared/logic/types.js';
import { ClientGameState, OnlinePlayer } from '../shared/types/websocket.js';
import { AIContext } from '../shared/logic/ai/types.js';
import { SimpleOpponentModel } from '../shared/logic/ai/opponentModel.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export type BotState = 'disconnected' | 'matchmaking' | 'playing';

export interface BotStatus {
  name: string;
  playerId: string | null;
  isConnected: boolean;
  state: BotState;
  tableId: string | null;
  seatNumber: number;
  handsPlayed: number;
  connectedAt: number | null;
  lastActionAt: number | null;
}

interface BotConfig {
  serverUrl: string;
  name: string;
  avatarUrl: string | null;
  disconnectChance?: number; // 各ハンド終了後に切断する確率 (0-1)
  defaultBlinds?: string; // デフォルトのブラインド設定（再キューイング用）
}

// デフォルト: 2% の確率で切断（約50ハンドに1回）
const DEFAULT_DISCONNECT_CHANCE = 0.02;

export class BotClient {
  private socket: Socket | null = null;
  private playerId: string | null = null;
  private holeCards: Card[] = [];
  private gameState: ClientGameState | null = null;
  private seatNumber: number = -1;
  private config: BotConfig;
  private isConnected = false;
  private tableId: string | null = null;
  private currentBlinds: string | null = null; // 現在のブラインド設定（再キューイング用）
  private handActions: GameAction[] = []; // 現ハンドのアクション履歴
  private opponentModel = new SimpleOpponentModel(); // ハンド間で統計を蓄積
  private stuckCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastInGameTime: number = 0; // 最後にゲームに参加していた時刻
  private handsPlayed: number = 0;
  private connectedAt: number | null = null;
  private lastActionAt: number | null = null;
  private actionGeneration = 0; // stale なアクションコールバックを防ぐ世代カウンター

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
        this.connectedAt = Date.now();
      });

      this.socket.on('connection:established', (data: { playerId: string }) => {
        this.playerId = data.playerId;
        console.log(`[${this.config.name}] Authenticated as ${this.playerId}`);
        this.startStuckCheck();
        resolve();
      });

      this.socket.on('connect_error', (err) => {
        console.error(`[${this.config.name}] Connection error:`, err.message);
        reject(err);
      });

      this.socket.on('disconnect', () => {
        console.log(`[${this.config.name}] Disconnected from server`);
        this.isConnected = false;
        this.connectedAt = null;
        this.tableId = null;
        this.seatNumber = -1;
        this.stopStuckCheck();
      });

      // Game events
      this.socket.on('table:joined', (data: { tableId: string; seat: number }) => {
        this.tableId = data.tableId;
        this.seatNumber = data.seat;
        this.lastInGameTime = Date.now();
        this.actionGeneration++; // 新テーブル参加時に旧アクションを無効化
        console.log(`[${this.config.name}] Joined table ${data.tableId} at seat ${data.seat}`);
      });

      this.socket.on('table:left', () => {
        console.log(`[${this.config.name}] Left table`);
        this.tableId = null;
        this.seatNumber = -1;
        this.actionGeneration++; // テーブル離脱時に旧アクションを無効化
        // 自動的に再度マッチメイキングに参加
        this.rejoinMatchmaking();
      });

      this.socket.on('table:closed', () => {
        console.log(`[${this.config.name}] Table closed`);
        this.tableId = null;
        this.seatNumber = -1;
        this.actionGeneration++; // テーブル閉鎖時に旧アクションを無効化
        // 自動的に再度マッチメイキングに参加
        this.rejoinMatchmaking();
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

      this.socket.on('game:action_taken', (data: { playerId: string; action: Action; amount: number; seat: number }) => {
        // 現ハンドのアクション履歴を蓄積
        this.handActions.push({
          playerId: data.seat,
          action: data.action,
          amount: data.amount,
        });
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
        // ハンド完了時に保留中のアクションコールバックを無効化
        this.actionGeneration++;

        // 相手モデルを更新（ハンド間の統計蓄積）
        if (this.handActions.length > 0 && this.gameState) {
          const activePlayers = Object.keys(this.gameState.players)
            .map(Number)
            .filter(seat => this.gameState!.players[seat]);
          this.opponentModel.updateFromActions(this.handActions, activePlayers);
        }

        // Reset for next hand
        this.handsPlayed++;
        this.holeCards = [];
        this.handActions = [];

        // 一定確率で意図的に切断（人間らしさを演出）
        this.maybeDisconnectRandomly();
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

    // Get AI decision with context (new AI modules)
    const aiDecision = getCPUAction(aiGameState, this.seatNumber, {
      botName: this.config.name,
      opponentModel: this.opponentModel,
      handActions: this.handActions,
    });

    // Validate action against valid actions
    const validAction = data.validActions.find(a => a.action === aiDecision.action);
    // 世代を記録して、コールバック時にstaleでないか検証する
    const gen = this.actionGeneration;

    if (validAction) {
      // Clamp amount to valid range
      let amount = aiDecision.amount;
      if (aiDecision.action === 'bet' || aiDecision.action === 'raise') {
        amount = Math.max(validAction.minAmount, Math.min(validAction.maxAmount, amount));
      }

      // Add thinking delay (800-2000ms)
      const delay = 800 + Math.random() * 1200;
      setTimeout(() => {
        if (this.actionGeneration !== gen) return; // stale: ハンド完了やテーブル移動で無効化済み
        this.sendAction(aiDecision.action, amount);
      }, delay);
    } else {
      // Fallback: check or fold
      const checkAction = data.validActions.find(a => a.action === 'check');
      const callAction = data.validActions.find(a => a.action === 'call');

      if (checkAction) {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('check', 0);
        }, 800);
      } else if (callAction) {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('call', callAction.minAmount);
        }, 800);
      } else {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('fold', 0);
        }, 800);
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
          hasActed: onlinePlayer.hasActed,
          isSittingOut: false,
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
          hasActed: true,
          isSittingOut: true,
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
      lastFullRaiseBet: this.gameState.currentBet,
      handHistory: this.handActions,
      isHandComplete: false,
      winners: [],
    };
  }

  private sendAction(action: Action, amount: number): void {
    if (!this.socket || !this.isConnected) return;

    console.log(`[${this.config.name}] Action: ${action}${amount > 0 ? ` $${amount}` : ''}`);
    this.lastActionAt = Date.now();
    this.socket.emit('game:action', { action, amount });
  }

  async joinMatchmaking(blinds: string): Promise<void> {
    if (!this.socket || !this.isConnected) {
      throw new Error('Not connected to server');
    }

    this.currentBlinds = blinds;
    console.log(`[${this.config.name}] Joining matchmaking pool (${blinds})`);
    this.socket.emit('matchmaking:join', { blinds });
  }

  private rejoinMatchmaking(): void {
    const blinds = this.currentBlinds ?? this.config.defaultBlinds ?? '1/3';
    // 少し遅延して再参加（サーバー側の状態更新を待つ）
    setTimeout(() => {
      if (this.isConnected && this.socket && !this.tableId) {
        console.log(`[${this.config.name}] Rejoining matchmaking pool (${blinds})`);
        this.socket.emit('matchmaking:join', { blinds });
      }
    }, 500);
  }

  async leaveMatchmaking(blinds: string): Promise<void> {
    if (!this.socket) return;
    this.socket.emit('matchmaking:leave', { blinds });
  }

  private maybeDisconnectRandomly(): void {
    const chance = this.config.disconnectChance ?? DEFAULT_DISCONNECT_CHANCE;
    if (Math.random() < chance) {
      // 少し遅延してから切断（自然な感じに）
      const delay = 1000 + Math.random() * 3000; // 1-4秒後
      console.log(`[${this.config.name}] Will disconnect in ${Math.round(delay)}ms (simulating player leave)`);
      setTimeout(() => {
        if (this.isConnected) {
          console.log(`[${this.config.name}] Intentionally disconnecting`);
          this.disconnect();
        }
      }, delay);
    }
  }

  // ゲームに参加できていない状態が続いたら自動で再マッチメイキング
  private startStuckCheck(): void {
    this.stopStuckCheck();
    this.lastInGameTime = Date.now();
    this.stuckCheckInterval = setInterval(() => {
      if (!this.isConnected) return;
      if (this.tableId) {
        // ゲームに参加中 → 時刻を更新
        this.lastInGameTime = Date.now();
        return;
      }
      // ゲーム未参加が15秒以上続いたら再マッチメイキング
      const stuckDuration = Date.now() - this.lastInGameTime;
      if (stuckDuration > 15000) {
        console.log(`[${this.config.name}] Stuck without game for ${Math.round(stuckDuration / 1000)}s, rejoining matchmaking`);
        this.lastInGameTime = Date.now(); // リセットして連続発火を防ぐ
        this.rejoinMatchmaking();
      }
    }, 5000);
  }

  private stopStuckCheck(): void {
    if (this.stuckCheckInterval) {
      clearInterval(this.stuckCheckInterval);
      this.stuckCheckInterval = null;
    }
  }

  /**
   * クリーンに切断する。table:leave / matchmaking:leave を送信してから disconnect。
   * @returns サーバー側のクリーンアップ完了を待つ Promise
   */
  async disconnect(): Promise<void> {
    this.stopStuckCheck();
    if (this.socket && this.isConnected) {
      // テーブルに着席中なら明示的に離席
      if (this.tableId) {
        this.socket.emit('table:leave');
      }
      // マッチメイキング中なら明示的にキュー離脱
      const blinds = this.currentBlinds ?? this.config.defaultBlinds ?? '1/3';
      this.socket.emit('matchmaking:leave', { blinds });

      // disconnect パケットがサーバーに届くよう少し待つ
      await new Promise<void>(resolve => {
        this.socket!.on('disconnect', () => resolve());
        this.socket!.disconnect();
        // 安全弁: 1秒以内に disconnect イベントが来なければ強制resolve
        setTimeout(resolve, 1000);
      });
      this.socket = null;
    } else if (this.socket) {
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

  getStatus(): BotStatus {
    let state: BotState = 'disconnected';
    if (this.isConnected) {
      state = this.tableId ? 'playing' : 'matchmaking';
    }
    return {
      name: this.config.name,
      playerId: this.playerId,
      isConnected: this.isConnected,
      state,
      tableId: this.tableId,
      seatNumber: this.seatNumber,
      handsPlayed: this.handsPlayed,
      connectedAt: this.connectedAt,
      lastActionAt: this.lastActionAt,
    };
  }
}
