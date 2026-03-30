import { io, Socket } from 'socket.io-client';
import { getCPUAction } from '../shared/logic/cpuAI.js';
import { GameState, Card, Action, Player, Position, GameAction, GameVariant } from '../shared/logic/types.js';
import { ClientGameState, OnlinePlayer } from '../shared/types/websocket.js';
import { AIContext } from '../shared/logic/ai/types.js';
import { SimpleOpponentModel } from '../shared/logic/ai/opponentModel.js';

const POSITIONS: Position[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];

export type BotState = 'disconnected' | 'matchmaking' | 'playing' | 'tournament_registered' | 'tournament_playing' | 'tournament_eliminated';

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

export interface BotConfig {
  serverUrl: string;
  name: string;
  avatarUrl: string | null;
  disconnectChance?: number; // 各ハンド終了後に切断する確率 (0-1)
  midHandDisconnectChance?: number; // ハンド中（他プレイヤーのターン時）に強制切断する確率 (0-1)
  defaultBlinds?: string; // デフォルトのブラインド設定（再キューイング用）
  variant?: string; // ゲームバリアント（'plo' | 'stud' 等）
  isFastFold?: boolean; // ファストフォールドテーブルに参加するか
  maxHandsPerSession?: number; // セッション上限ハンド数（到達で自動離席）
  noDelay?: boolean; // true: 思考時間を0にする（テスト・デバッグ用）
  onJoinFailed?: (bot: BotClient, reason: string) => void; // マッチメイキング参加失敗時コールバック
  // --- トーナメント用 ---
  tournamentMode?: boolean; // true: トーナメントモード（ランダム切断・再マッチメイキング無効）
  tournamentChaosMode?: boolean; // true: トーナメント中にランダム切断→再接続を行う（不具合再現用）
  onTournamentEliminated?: (bot: BotClient, position: number) => void;
  onTournamentCompleted?: (bot: BotClient) => void;
  botSecret?: string; // 本番環境でのBot認証シークレット
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
  private isThinking = false; // handleMyTurn の重複呼び出しを防ぐ
  private pendingFastFoldCheck = false; // ホールカード受信後のファストフォールド判定待ち
  private _isMaintenanceActive = false; // サーバーがメンテナンス中か
  private tournamentId: string | null = null; // 参加中のトーナメントID
  private authToken: string | null = null; // REST API用JWTトークン
  private chaosReconnectTimer: ReturnType<typeof setTimeout> | null = null; // chaosMode: 再接続タイマー
  private isTournamentEliminated = false; // トーナメント脱落済みフラグ

  constructor(config: BotConfig) {
    this.config = config;
  }

  get isMaintenanceActive(): boolean {
    return this._isMaintenanceActive;
  }

  async connect(): Promise<void> {
    // 1. REST API でログイン → JWT取得（人間と同じ認証フロー）
    const loginRes = await fetch(`${this.config.serverUrl}/api/auth/bot-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        botName: this.config.name,
        ...(this.config.botSecret ? { botSecret: this.config.botSecret } : {}),
      }),
    });
    if (!loginRes.ok) {
      const body = await loginRes.json().catch(() => ({}));
      throw new Error(`Bot login failed: ${(body as any).error ?? loginRes.statusText}`);
    }
    const loginData = await loginRes.json() as { token: string; user: { id: string; username: string } };
    this.authToken = loginData.token;
    this.playerId = loginData.user.id;
    console.log(`[${this.config.name}] Logged in as ${this.playerId} (${loginData.user.username})`);

    // 2. JWT付きでWebSocket接続（人間と同じ方法）
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        auth: {
          token: this.authToken,
        },
      });

      this.socket.on('connect', () => {
        console.log(`[${this.config.name}] Connected to server`);
        this.isConnected = true;
        this.connectedAt = Date.now();
      });

      this.socket.on('connection:established', (data: { playerId: string }) => {
        console.log(`[${this.config.name}] Authenticated as ${data.playerId}`);
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

      this.registerSocketListeners();

      // Timeout for connection
      setTimeout(() => {
        if (!this.playerId) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  /**
   * game:state で自分のターンを検知したときの処理（フロントと同じアプローチ）
   * validActions はサーバーから受け取らず、自前の gameState から計算する
   */
  /**
   * ソケットのゲーム・トーナメントイベントリスナーを登録する。
   * connect() と chaosReconnect() の両方から呼ばれる。
   */
  private registerSocketListeners(): void {
    if (!this.socket) return;

    // Game events
    this.socket.on('table:joined', (data: { tableId: string; seat: number }) => {
      this.tableId = data.tableId;
      this.seatNumber = data.seat;
      this.lastInGameTime = Date.now();
      this.actionGeneration++; this.isThinking = false;
      console.log(`[${this.config.name}] Joined table ${data.tableId} at seat ${data.seat}`);
    });

    this.socket.on('table:left', () => {
      console.log(`[${this.config.name}] Left table`);
      this.tableId = null;
      this.seatNumber = -1;
      this.actionGeneration++; this.isThinking = false;
    });

    this.socket.on('table:closed', () => {
      console.log(`[${this.config.name}] Table closed`);
      this.tableId = null;
      this.seatNumber = -1;
      this.actionGeneration++; this.isThinking = false;
    });

    // ファストフォールド: テーブル移動
    this.socket.on('table:change', (data: { tableId: string; seat: number }) => {
      this.tableId = data.tableId;
      this.seatNumber = data.seat;
      this.holeCards = [];
      this.handActions = [];
      this.actionGeneration++; this.isThinking = false;
      this.pendingFastFoldCheck = false;
      this.lastInGameTime = Date.now();
      console.log(`[${this.config.name}] Table changed to ${data.tableId} seat ${data.seat}`);
    });

    this.socket.on('table:busted', (data: { message: string }) => {
      console.log(`[${this.config.name}] Busted: ${data.message}`);
      this.tableId = null;
      this.seatNumber = -1;
      this.actionGeneration++; this.isThinking = false;
    });

    this.socket.on('table:error', (data: { message: string }) => {
      console.log(`[${this.config.name}] Table error: ${data.message}`);
      if (!this.tableId && this.config.onJoinFailed) {
        this.config.onJoinFailed(this, data.message);
      }
    });

    this.socket.on('maintenance:status', (data: { isActive: boolean; message: string }) => {
      this._isMaintenanceActive = data.isActive;
      if (data.isActive) {
        console.log(`[${this.config.name}] Maintenance mode active: ${data.message}`);
      } else {
        console.log(`[${this.config.name}] Maintenance mode ended`);
      }
    });

    this.socket.on('game:hole_cards', (data: { cards: Card[] }) => {
      const isUpdate = this.holeCards.length > 0;
      this.holeCards = data.cards;
      if (!isUpdate) {
        this.handActions = [];
        console.log(`[${this.config.name}] Received hole cards`);
        if (this.config.isFastFold) {
          this.pendingFastFoldCheck = true;
        }
      } else {
        console.log(`[${this.config.name}] Hole cards updated (draw)`);
      }
    });

    this.socket.on('game:state', (data: { state: ClientGameState }) => {
      this.gameState = data.state;
      if (this.pendingFastFoldCheck) {
        this.pendingFastFoldCheck = false;
        this.maybeEarlyFold();
      }
      if (data.state.currentPlayerSeat === this.seatNumber && data.state.isHandInProgress) {
        this.handleMyTurn();
      }
    });

    this.socket.on('game:action_taken', (data: { playerId: string; action: Action; amount: number; seat: number }) => {
      this.handActions.push({
        playerId: data.seat,
        action: data.action,
        amount: data.amount,
      });

      // ハンド中に強制切断（自分のターンでない時）
      if (data.seat !== this.seatNumber) {
        if (this.config.tournamentChaosMode) {
          this.maybeTournamentChaosDisconnect('mid_hand');
        } else {
          this.maybeMidHandDisconnect();
        }
      }
    });

    this.socket.on('game:hand_complete', () => {
      this.actionGeneration++; this.isThinking = false;

      if (this.handActions.length > 0 && this.gameState) {
        const activePlayers = Object.keys(this.gameState.players)
          .map(Number)
          .filter(seat => this.gameState!.players[seat]);
        this.opponentModel.updateFromActions(this.handActions, activePlayers);
      }

      this.handsPlayed++;
      this.holeCards = [];
      this.handActions = [];

      if (this.config.maxHandsPerSession && this.handsPlayed >= this.config.maxHandsPerSession) {
        console.log(`[${this.config.name}] Session limit reached (${this.handsPlayed} hands), disconnecting`);
        this.disconnect();
        return;
      }

      if (this.config.tournamentMode) {
        if (this.config.tournamentChaosMode) {
          this.maybeTournamentChaosDisconnect('hand_complete');
        }
        return;
      }

      this.maybeDisconnectRandomly();
    });

    // --- トーナメントイベント ---

    this.socket.on('tournament:table_assigned', (data: { tableId: string }) => {
      console.log(`[${this.config.name}] Tournament table assigned: ${data.tableId}`);
    });

    this.socket.on('tournament:eliminated', (data: { position: number; totalPlayers: number; prizeAmount: number }) => {
      console.log(`[${this.config.name}] Eliminated at position ${data.position}/${data.totalPlayers} (prize: ${data.prizeAmount})`);
      const eliminatedTournamentId = this.tournamentId;
      this.tournamentId = null;
      this.isTournamentEliminated = true;

      // リエントリー試行（トーナメントモードのみ）
      if (eliminatedTournamentId && this.config.tournamentMode) {
        this.attemptReentry(eliminatedTournamentId).then(reentered => {
          if (!reentered) {
            this.config.onTournamentEliminated?.(this, data.position);
          }
        });
      } else {
        this.config.onTournamentEliminated?.(this, data.position);
      }
    });

    this.socket.on('tournament:completed', () => {
      console.log(`[${this.config.name}] Tournament completed`);
      this.tournamentId = null;
      this.config.onTournamentCompleted?.(this);
    });

    this.socket.on('tournament:table_move', (data: { fromTableId: string; toTableId: string }) => {
      console.log(`[${this.config.name}] Table move: ${data.fromTableId} → ${data.toTableId}`);
      this.actionGeneration++; this.isThinking = false;
      this.holeCards = [];
      this.handActions = [];
    });

    this.socket.on('tournament:blind_change', (data: { level: { level: number; smallBlind: number; bigBlind: number } }) => {
      console.log(`[${this.config.name}] Blind level up: Lv.${data.level.level} (${data.level.smallBlind}/${data.level.bigBlind})`);
    });

    this.socket.on('tournament:error', (data: { message: string }) => {
      console.error(`[${this.config.name}] Tournament error: ${data.message}`);
    });
  }

  private handleMyTurn(): void {
    // 同じターンで複数の game:state が来ても重複実行しない
    if (this.isThinking) return;
    this.isThinking = true;

    // Build GameState for AI
    const aiGameState = this.buildGameStateForAI();
    if (!aiGameState) {
      this.sendAction('check', 0);
      return;
    }

    // サーバーから受信した validActions を使用（バリアント間の不一致を防止）
    const validActions = (this.gameState?.validActions as { action: Action; minAmount: number; maxAmount: number }[]) ?? [];

    if (validActions.length === 0) {
      return;
    }

    // holeCardsの整合性チェック（undefinedカードが含まれていないか）
    const myCards = aiGameState.players[this.seatNumber]?.holeCards ?? [];
    if (myCards.length === 0 || myCards.some(c => !c || !c.rank)) {
      const callAction = validActions.find(a => a.action === 'call');
      const checkAction = validActions.find(a => a.action === 'check');
      if (callAction) {
        this.sendAction('call', callAction.minAmount);
      } else if (checkAction) {
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
    const validAction = validActions.find(a => a.action === aiDecision.action);
    // 世代を記録して、コールバック時にstaleでないか検証する
    const gen = this.actionGeneration;

    if (validAction) {
      // Clamp amount to valid range
      let amount = aiDecision.amount;
      if (aiDecision.action === 'call') {
        amount = validAction.minAmount;
      } else if (aiDecision.action === 'bet' || aiDecision.action === 'raise') {
        amount = Math.max(validAction.minAmount, Math.min(validAction.maxAmount, amount));
      }

      // シチュエーションに応じた思考時間
      const delay = this.computeThinkingDelay(aiDecision.action, amount, validActions);
      setTimeout(() => {
        if (this.actionGeneration !== gen) return;
        this.sendAction(aiDecision.action, amount, aiDecision.discardIndices);
      }, delay);
    } else {
      // Fallback: draw > check > call > fold
      const drawAction = validActions.find(a => a.action === 'draw');
      const checkAction = validActions.find(a => a.action === 'check');
      const callAction = validActions.find(a => a.action === 'call');
      const fallbackDelay = this.config.noDelay ? 0 : 800;

      if (drawAction) {
        // ドローフェーズでAI判定が失敗した場合: スタンドパット
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('draw', 0, []);
        }, fallbackDelay);
      } else if (checkAction) {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('check', 0);
        }, fallbackDelay);
      } else if (callAction) {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('call', callAction.minAmount);
        }, fallbackDelay);
      } else {
        setTimeout(() => {
          if (this.actionGeneration !== gen) return;
          this.sendAction('fold', 0);
        }, fallbackDelay);
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
          holeCards: i === this.seatNumber ? this.holeCards : (onlinePlayer.cards ?? []),
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
      rake: 0,
      variant: (this.gameState.variant as GameVariant) ?? 'plo',
      ante: this.gameState.ante ?? 0,
      bringIn: this.gameState.bringIn ?? 0,
      betCount: 0,
      maxBetsPerRound: 4,
    };
  }

  /**
   * シチュエーションに応じた思考時間を算出する
   * - チェック/フォールド: 速い（ほぼ即決）
   * - リバーの大きいベット/レイズに直面: 長考
   * - 3betに直面（プリフロップ）: 長考
   * - オールイン判断: 最大級の長考
   */
  private computeThinkingDelay(
    action: Action,
    amount: number,
    validActions: { action: Action; minAmount: number; maxAmount: number }[],
  ): number {
    const street = this.gameState?.currentStreet ?? 'preflop';
    const pot = this.gameState?.pot ?? 0;

    // ベース遅延 (ms)
    let base = 2000;
    let variance = 2000;

    // --- アクション種別による調整 ---

    // チェックやフォールドは比較的速め
    if (action === 'check') {
      base = 1500;
      variance = 1500;
    } else if (action === 'fold') {
      base = 1800;
      variance = 1500;
    }

    // コールはしっかり悩む（スナップコール防止）
    if (action === 'call') {
      base = 3000;
      variance = 2500;
    }

    // ベット/レイズは考える
    if (action === 'bet' || action === 'raise') {
      base = 3000;
      variance = 2500;
    }

    // --- ストリート補正（後のストリートほど判断が重い） ---

    if (street === 'flop') {
      base += 500;
      variance += 500;
    } else if (street === 'turn') {
      base += 1000;
      variance += 800;
    }
    // リバーの補正は下記のシチュエーション補正で処理

    // --- シチュエーション補正 ---

    // プリフロップで3betに直面している判定:
    // handActionsにraise/betが2回以上ある = 3bet以上が入っている
    if (street === 'preflop') {
      const preflopRaises = this.handActions.filter(
        a => a.action === 'raise' || a.action === 'bet',
      ).length;
      if (preflopRaises >= 2) {
        // 3betに直面 → 長考
        base += 2500;
        variance += 1500;
      }
    }

    // リバーでベットに直面している
    if (street === 'river') {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction && callAction.minAmount > 0) {
        const betRatio = callAction.minAmount / Math.max(pot, 1);
        if (betRatio >= 0.5) {
          // 大きいベットに直面 → 長考
          base += 3000 + betRatio * 2000;
          variance += 2000;
        } else if (betRatio >= 0.25) {
          base += 1500;
          variance += 1000;
        }
      }
      // リバーで自分がベット/レイズする場合も考える
      if (action === 'bet' || action === 'raise') {
        base += 1500;
        variance += 1000;
      }
    }

    // オールインは最も悩む（自分のスタックの大部分を投入する場合）
    if (action === 'allin') {
      base += 4000;
      variance += 3000;
    }
    // コール額がスタックの50%以上ならオールイン級の長考
    if (action === 'call') {
      const myPlayer = this.gameState?.players[this.seatNumber];
      if (myPlayer) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction && callAction.minAmount > myPlayer.chips * 0.5) {
          base += 3000;
          variance += 2000;
        }
      }
    }

    // ランダムな長考（人間らしさ）: 約12%の確率で追加タンク
    if (Math.random() < 0.12) {
      base += 3000 + Math.random() * 4000;
    }

    // noDelay モード: 思考時間ゼロ
    if (this.config.noDelay) return 0;

    // 最大12秒、最小1000msにクランプ（持ち時間20秒）
    const delay = (base + Math.random() * variance) * 0.8;
    return Math.max(1000, Math.min(12000, delay));
  }

  private sendAction(action: Action, amount: number, discardIndices?: number[]): void {
    if (!this.socket || !this.isConnected) return;

    this.isThinking = false;
    const discardInfo = discardIndices ? ` (discard ${discardIndices.length})` : '';
    console.log(`[${this.config.name}] Action: ${action}${amount > 0 ? ` $${amount}` : ''}${discardInfo}`);
    this.lastActionAt = Date.now();
    this.socket.emit('game:action', { action, amount, discardIndices });
  }

  /**
   * ファストフォールド: ターン前にAIがフォールド判定したら即座にfold送信
   */
  private maybeEarlyFold(): void {
    if (!this.gameState || !this.socket || !this.isConnected) return;
    if (this.holeCards.length === 0) return;

    // 既に自分のターンなら通常フローに任せる
    if (this.gameState.currentPlayerSeat === this.seatNumber) return;

    // BBはプリフロップでファストフォールドできない
    const posIndex = (this.seatNumber - this.gameState.dealerSeat + 6) % 6;
    if (POSITIONS[posIndex] === 'BB' && this.gameState.currentStreet === 'preflop') return;

    // AIに判断させる
    const aiGameState = this.buildGameStateForAI();
    if (!aiGameState) return;

    const aiDecision = getCPUAction(aiGameState, this.seatNumber, {
      botName: this.config.name,
      opponentModel: this.opponentModel,
      handActions: this.handActions,
    });

    if (aiDecision.action === 'fold') {
      const gen = ++this.actionGeneration;
      const delay = 1000 + Math.random() * 1000; // 1000-2000ms（自然な遅延）
      setTimeout(() => {
        if (this.actionGeneration !== gen) return;
        if (!this.socket || !this.isConnected) return;
        console.log(`[${this.config.name}] Fast fold (early)`);
        this.lastActionAt = Date.now();
        this.socket.emit('game:fast_fold');
      }, delay);
    }
  }

  async joinMatchmaking(blinds: string, variant?: string): Promise<void> {
    if (!this.socket || !this.isConnected) {
      throw new Error('Not connected to server');
    }

    this.currentBlinds = blinds;
    const isFastFold = this.config.isFastFold;
    const v = variant ?? this.config.variant;
    console.log(`[${this.config.name}] Joining matchmaking pool (${blinds}${isFastFold ? ', FF' : ''}${v ? ', ' + v : ''})`);
    this.socket.emit('matchmaking:join', { blinds, isFastFold, variant: v });
  }

  async joinTournament(tournamentId: string): Promise<void> {
    if (!this.socket || !this.isConnected || !this.authToken) {
      throw new Error('Not connected to server or no auth token');
    }

    console.log(`[${this.config.name}] Registering for tournament ${tournamentId}`);

    // REST API で参加登録（人間と同じフロー）
    const res = await fetch(`${this.config.serverUrl}/api/tournaments/${tournamentId}/register`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.authToken}`,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      let errorMsg: string;
      try {
        const body = JSON.parse(text);
        errorMsg = body.error ?? res.statusText;
      } catch {
        errorMsg = text || res.statusText;
      }
      throw new Error(`Tournament register failed: ${errorMsg}`);
    }

    this.tournamentId = tournamentId;

    // ゲーム画面遷移と同じフロー: テーブル着席＋状態取得
    this.socket.emit('tournament:request_state', { tournamentId });
  }

  getTournamentId(): string | null {
    return this.tournamentId;
  }

  /**
   * 脱落後にリエントリーを試みる。
   * 成功したら true を返し、上限到達・残高不足などで失敗したら false を返して切断する。
   */
  private async attemptReentry(tournamentId: string): Promise<boolean> {
    if (!this.socket || !this.isConnected || !this.authToken) return false;

    console.log(`[${this.config.name}] Attempting reentry for tournament ${tournamentId}...`);

    try {
      const res = await fetch(`${this.config.serverUrl}/api/tournaments/${tournamentId}/reenter`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.authToken}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        console.log(`[${this.config.name}] Reentry denied: ${(body as any).error ?? res.statusText} → disconnecting`);
        this.disconnect();
        return false;
      }

      console.log(`[${this.config.name}] Reentry successful, requesting state...`);
      this.isTournamentEliminated = false;
      this.tournamentId = tournamentId;
      this.holeCards = [];
      this.handActions = [];
      this.actionGeneration++;
      this.isThinking = false;
      this.socket.emit('tournament:request_state', { tournamentId });
      return true;
    } catch (err) {
      console.error(`[${this.config.name}] Reentry error:`, err);
      this.disconnect();
      return false;
    }
  }

  async joinPrivateTable(inviteCode: string): Promise<void> {
    if (!this.socket || !this.isConnected) {
      throw new Error('Not connected to server');
    }

    console.log(`[${this.config.name}] Joining private table (code: ${inviteCode})`);
    this.socket.emit('private:join', { inviteCode });
  }

  private rejoinMatchmaking(): void {
    const blinds = this.currentBlinds ?? this.config.defaultBlinds ?? '1/3';
    // 少し遅延して再参加（サーバー側の状態更新を待つ）
    setTimeout(() => {
      if (this.isConnected && this.socket && !this.tableId) {
        const isFastFold = this.config.isFastFold;
        const variant = this.config.variant;
        console.log(`[${this.config.name}] Rejoining matchmaking pool (${blinds}${isFastFold ? ', FF' : ''}${variant ? ', ' + variant : ''})`);
        this.socket.emit('matchmaking:join', { blinds, isFastFold, variant });
      }
    }, 500);
  }

  async leaveMatchmaking(blinds: string): Promise<void> {
    if (!this.socket) return;
    this.socket.emit('matchmaking:leave', { blinds });
  }

  /**
   * テスト用: ハンド中に強制切断（table:leave を送らずソケットを切る）
   * サーバー側の handleDisconnect パスを通す
   */
  private maybeMidHandDisconnect(): void {
    const chance = this.config.midHandDisconnectChance ?? 0;
    if (chance <= 0 || Math.random() >= chance) return;

    const delay = 200 + Math.random() * 800;
    console.log(`[${this.config.name}] Mid-hand forced disconnect in ${Math.round(delay)}ms`);
    setTimeout(() => {
      if (!this.socket || !this.isConnected) return;
      // table:leave を送らずに直接切断 → handleDisconnect が発火
      this.stopStuckCheck();
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.playerId = null;
      this.tableId = null;
      this.seatNumber = -1;
      this.holeCards = [];
      this.gameState = null;
    }, delay);
  }

  /**
   * トーナメントchaosMode: ランダムに切断して数秒後に再接続する。
   * サーバー側の disconnect → reconnect パスを網羅的にテストする。
   */
  private maybeTournamentChaosDisconnect(trigger: 'mid_hand' | 'hand_complete'): void {
    if (this.isTournamentEliminated || !this.tournamentId) return;
    if (this.chaosReconnectTimer) return; // 既に切断→再接続中

    // mid_hand: 15% / hand_complete: 10%
    const chance = trigger === 'mid_hand' ? 0.15 : 0.10;
    if (Math.random() >= chance) return;

    const disconnectDelay = 100 + Math.random() * 500;
    console.log(`[${this.config.name}] 🔥 Chaos ${trigger}: disconnect in ${Math.round(disconnectDelay)}ms`);

    const tournamentId = this.tournamentId;

    setTimeout(() => {
      if (!this.socket || !this.isConnected || this.isTournamentEliminated) return;

      // table:leave を送らずに直接切断 → サーバー側 handleDisconnect が発火
      this.stopStuckCheck();
      this.actionGeneration++;
      this.isThinking = false;
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      this.tableId = null;
      this.seatNumber = -1;
      this.holeCards = [];
      this.gameState = null;

      // 1〜8秒後に再接続
      const reconnectDelay = 1000 + Math.random() * 7000;
      console.log(`[${this.config.name}] 🔥 Chaos: reconnect in ${Math.round(reconnectDelay)}ms`);

      this.chaosReconnectTimer = setTimeout(async () => {
        this.chaosReconnectTimer = null;
        if (this.isTournamentEliminated) return;

        try {
          await this.chaosReconnect(tournamentId);
          console.log(`[${this.config.name}] 🔥 Chaos: reconnected to tournament ${tournamentId}`);
        } catch (err) {
          console.error(`[${this.config.name}] 🔥 Chaos: reconnect failed:`, err);
        }
      }, reconnectDelay);
    }, disconnectDelay);
  }

  /**
   * chaosMode用: 新しいソケットで再接続し、トーナメントに復帰する。
   * 人間の「アプリ再起動→トーナメント画面に戻る」フローと同じ。
   */
  private async chaosReconnect(tournamentId: string): Promise<void> {
    // playerId は保持（同じbotアカウント）。authToken も再利用。
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        autoConnect: true,
        auth: {
          token: this.authToken,
        },
      });

      const onEstablished = () => {
        this.isConnected = true;
        this.connectedAt = Date.now();
        this.startStuckCheck();

        // トーナメント復帰: テーブル再着席＋状態取得
        this.socket!.emit('tournament:request_state', { tournamentId });
        this.tournamentId = tournamentId;
        resolve();
      };

      const onError = (err: Error) => {
        reject(err);
      };

      this.socket.once('connection:established', onEstablished);
      this.socket.once('connect_error', onError);

      // イベントリスナーを再登録（新しいソケットなので必要）
      this.registerSocketListeners();
    });
  }

  private maybeDisconnectRandomly(): void {
    const chance = this.config.disconnectChance ?? DEFAULT_DISCONNECT_CHANCE;
    if (Math.random() < chance) {
      console.log(`[${this.config.name}] Intentionally disconnecting`);
      this.disconnect();
    }
  }

  // ゲームに参加できていない状態が続いたら自動で再マッチメイキング
  private startStuckCheck(): void {
    this.stopStuckCheck();
    this.lastInGameTime = Date.now();
    this.stuckCheckInterval = setInterval(() => {
      if (!this.isConnected) return;
      // メンテナンス中はスタック判定をスキップ
      if (this._isMaintenanceActive) {
        this.lastInGameTime = Date.now();
        return;
      }
      if (this.tableId) {
        // ゲームに参加中 → 時刻を更新
        this.lastInGameTime = Date.now();
        return;
      }
      // トーナメントモードではスタック判定をスキップ（登録待ち時間がある）
      if (this.config.tournamentMode) return;
      // ゲーム未参加が15秒以上続いたら再マッチメイキング
      const stuckDuration = Date.now() - this.lastInGameTime;
      if (stuckDuration > 15000) {
        console.log(`[${this.config.name}] Stuck without game for ${Math.round(stuckDuration / 1000)}s, disconnecting`);
        this.disconnect();
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
      if (this.config.tournamentMode) {
        state = this.tableId ? 'tournament_playing' : (this.tournamentId ? 'tournament_registered' : 'tournament_eliminated');
      } else {
        state = this.tableId ? 'playing' : 'matchmaking';
      }
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
