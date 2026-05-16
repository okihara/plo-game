import { Server, Socket } from 'socket.io';
import { GameState, Action, GameVariant, getVariantConfig } from '../../shared/logic/types.js';
import { isDrawStreet } from '../../shared/logic/drawEngine.js';
import { getActivePlayers, calculateSidePots } from '../../shared/logic/gameEngine.js';
import { calculateAllInEVProfits } from '../../shared/logic/equityCalculator.js';
import { ClientGameState } from '../../shared/types/websocket.js';
import { nanoid } from 'nanoid';

// ヘルパーモジュール
import { TABLE_CONSTANTS } from './constants.js';
import { MessageLog, PendingAction, AdminSeat, DebugState, GameMode, TableLifecycleCallbacks } from './types.js';
import { PlayerManager } from './helpers/PlayerManager.js';
import { ActionController } from './helpers/ActionController.js';
import { BroadcastService } from './helpers/BroadcastService.js';
import { StateTransformer } from './helpers/StateTransformer.js';
import { IHandHistoryRecorder, HandHistoryRecorder } from './helpers/HandHistoryRecorder.js';
import { AdminHelper } from './helpers/AdminHelper.js';
import { VariantAdapter } from './helpers/VariantAdapter.js';
import { maintenanceService } from '../maintenance/MaintenanceService.js';

// 型の再エクスポート（後方互換性のため）
export type { MessageLog, PendingAction };

export class TableInstance {
  public readonly id: string;
  public blinds: string;
  public smallBlind: number;
  public bigBlind: number;
  /** ブラインドレベルから渡されるアンテ額。bomb pot / Stud では > 0 になる。 */
  public ante: number = 0;
  public readonly maxPlayers: number = TABLE_CONSTANTS.MAX_PLAYERS;
  public isFastFold: boolean = false;
  public readonly variant: GameVariant = 'plo';
  public readonly isPrivate: boolean = false;
  public readonly inviteCode: string | null = null;

  // ゲームモード（キャッシュ / トーナメント）
  public readonly gameMode: GameMode = 'cash';
  /** トーナメント所属テーブルのとき、所属トーナメント ID。キャッシュゲームでは null */
  public readonly tournamentId: string | null = null;
  private readonly lifecycleCallbacks: TableLifecycleCallbacks;

  // HORSE (MIXゲーム) モード
  public readonly isHorse: boolean = false;
  private horseVariants: GameVariant[] = ['limit_holdem', 'omaha_hilo', 'razz', 'stud', 'stud_hilo'];
  private horseCurrentIndex: number = 0;
  private horseHandCount: number = 0;
  private horseHandsPerRound: number = 0;

  // ファストフォールド: ハンド完了後に全プレイヤーを再割り当てするコールバック
  public onFastFoldReassign?: (players: { odId: string; chips: number; socket: Socket; odName: string; displayName?: string | null; avatarUrl: string | null; nameMasked: boolean; hasWeeklyChampion?: boolean }[]) => void;

  // ファストフォールド: タイムアウトフォールド時にテーブル移動するコールバック
  public onTimeoutFold?: (odId: string, socket: Socket) => Promise<void>;

  private gameState: GameState | null = null;
  private lastDealerPosition = -1;
  private isRunOutInProgress = false;
  private showdownSentDuringRunOut = false;
  private _isHandInProgress = false;
  /** 最初のオールイン発生時のコミュニティカード枚数（EV計算用） */
  private allInStreetCardCount: number | null = null;

  public get isHandInProgress(): boolean {
    return this._isHandInProgress;
  }
  private pendingStartHand = false;

  // ファストフォールド: 手番が来るまで保留するフォールド (seatIndex → odId)
  private pendingEarlyFolds: Map<number, string> = new Map();

  /** 観戦者（着席なし・socket.id → Socket） */
  private spectators: Map<string, Socket> = new Map();

  // ヘルパーインスタンス
  private readonly playerManager: PlayerManager;
  private readonly broadcast: BroadcastService;
  private actionController: ActionController;
  private readonly historyRecorder: IHandHistoryRecorder;
  private readonly adminHelper: AdminHelper;
  private variantAdapter: VariantAdapter;

  constructor(io: Server, blinds: string = '1/3', isFastFold: boolean = false, options?: { isPrivate?: boolean; inviteCode?: string; variant?: GameVariant; historyRecorder?: IHandHistoryRecorder; isHorse?: boolean; gameMode?: GameMode; lifecycleCallbacks?: TableLifecycleCallbacks; tournamentId?: string }) {
    this.id = nanoid(12);
    this.blinds = blinds;
    this.isFastFold = isFastFold;
    this.isHorse = options?.isHorse ?? false;
    this.variant = this.isHorse ? 'limit_holdem' : (options?.variant ?? 'plo');
    this.isPrivate = options?.isPrivate ?? false;
    this.inviteCode = options?.inviteCode ?? null;
    this.gameMode = options?.gameMode ?? 'cash';
    this.tournamentId = options?.tournamentId ?? null;

    // デフォルト: キャッシュゲーム用コールバック（table:busted通知 → unseat）
    this.lifecycleCallbacks = options?.lifecycleCallbacks ?? {
      onPlayerBusted: (_odId, _seatIndex, socket, _chipsAtHandStart) => {
        socket?.emit('table:busted', { message: 'チップがなくなりました' });
        return true; // TableInstanceがunseatPlayerを呼ぶ
      },
    };

    // blinds 文字列は "sb/bb" または "sb/bb/ante" 形式 (ante 省略時 0)
    const [sb, bb, ante] = blinds.split('/').map(Number);
    this.smallBlind = sb;
    this.bigBlind = bb;
    this.ante = ante || 0;

    // ヘルパー初期化
    const roomName = `table:${this.id}`;
    this.playerManager = new PlayerManager();
    this.broadcast = new BroadcastService(io, roomName);
    this.variantAdapter = new VariantAdapter(this.variant);
    const rakeOptions = this.gameMode === 'tournament' ? { rakePercent: 0, rakeCapBB: 0 } : undefined;
    this.actionController = new ActionController(this.broadcast, this.variantAdapter, rakeOptions);
    this.historyRecorder = options?.historyRecorder ?? new HandHistoryRecorder(
      this.gameMode === 'tournament' && this.tournamentId ? { tournamentId: this.tournamentId } : undefined
    );
    this.adminHelper = new AdminHelper(this.playerManager, this.broadcast, this.actionController);
  }

  // ============================================
  // Public methods
  // ============================================

  // Add a player to the table
  public seatPlayer(
    odId: string,
    odName: string,
    socket: Socket | null,
    buyIn: number,
    avatarUrl?: string | null,
    preferredSeat?: number,
    options?: { skipJoinedEmit?: boolean },
    nameMasked?: boolean,
    displayName?: string | null,
    hasWeeklyChampion?: boolean
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
      hasWeeklyChampion,
    });

    if (seatIndex === null) {
      console.warn(`[Table ${this.id}] seatPlayer failed: odId=${odId}, odName=${odName}, buyIn=${buyIn}, preferredSeat=${preferredSeat}, handInProgress=${this.isHandInProgress}`);
      return null;
    }

    if (socket) {
      socket.join(this.roomName);

      // Notify the seated player
      if (!options?.skipJoinedEmit) {
        socket.emit('table:joined', { tableId: this.id, seat: seatIndex });
      }
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
        // 自分のターン → 正規のアクション処理経由で離脱
        // Studブリングインフェーズ等では fold が無効なため、有効アクションを選択
        this.actionController.clearTimers();
        const defaultAction = this.getDefaultDisconnectAction(seatIndex);
        this.handleAction(odId, defaultAction.action, defaultAction.amount, defaultAction.discardIndices, 'auto');
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
  public unseatForFastFold(odId: string): { odId: string; chips: number; socket: Socket | null; hasWeeklyChampion?: boolean } | null {
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
    const hasWeeklyChampion = seat.hasWeeklyChampion;

    // ソケットをルームから離脱
    if (socket) {
      socket.leave(this.roomName);
    }

    // 席情報は残してFastFold移動済みマーク（ハンド終了まで表示用に保持）
    this.playerManager.markLeftForFastFold(seatIndex);

    return { odId, chips, socket, hasWeeklyChampion };
  }

  /**
   * Handle player action.
   * @param source 'manual' = プレイヤー本人の入力（タイムアウトペナルティをリセット）
   *               'auto'   = タイムアウト/切断/離席による自動アクション（リセットしない）
   */
  public handleAction(
    odId: string,
    action: Action,
    amount: number,
    discardIndices?: number[],
    source: 'manual' | 'auto' = 'manual',
  ): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      // クライアント-サーバー間のレース（連打・遅延到着）で頻発するため info レベル
      console.log(`[Table ${this.id}] handleAction rejected: odId=${odId}, action=${action}, amount=${amount}, gameState=${!this.gameState ? 'null' : 'exists'}, isHandComplete=${this.gameState?.isHandComplete}, isRunOutInProgress=${this.isRunOutInProgress}`);
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) {
      console.warn(`[Table ${this.id}] handleAction: player not found at table, odId=${odId}`);
      return false;
    }
    // ランアウト検出用にカード枚数を保存
    const previousCardCount = this.gameState.communityCards.length;
    // オールインEV計算用: アクション前のオールイン状態を保存
    const hadAllInBefore = this.allInStreetCardCount !== null;

    // アクションを処理
    const result = this.actionController.handleAction(
      this.gameState,
      seatIndex,
      action,
      amount,
      odId,
      discardIndices
    );

    if (!result.success) {
      // 不正アクションはクライアントの遅延・誤タップで起きうるため info レベル
      console.log(`[Table ${this.id}] handleAction: action rejected by controller, odId=${odId}, seat=${seatIndex}, action=${action}, amount=${amount}, currentPlayer=${this.gameState.currentPlayerIndex}, reason=${result.rejectReason}`);
      return false;
    }

    // 手動アクション成功 → 連続タイムアウトカウンタをリセット
    if (source === 'manual') {
      this.playerManager.resetConsecutiveTimeouts(seatIndex);
    }

    this.gameState = result.gameState;

    // 新たにオールインしたプレイヤーがいれば、そのときのボード枚数を記録（最初の1回のみ）
    if (!hadAllInBefore && this.gameState.players.some(p => p.isAllIn)) {
      this.allInStreetCardCount = previousCardCount;
    }

    // Check if hand is complete
    if (result.handComplete) {
      const finalCardCount = this.gameState.communityCards.length;
      if (finalCardCount > previousCardCount) {
        // オールインでのランアウト: ストリートごとに段階的にカードを表示
        this.handleAllInRunOut(this.gameState, previousCardCount);
      } else {
        // 通常のハンド完了（全員フォールド or リバーベッティング終了）
        this.handleHandComplete().catch(e => console.error('handleHandComplete error:', e));
        // this.broadcastGameState();
      }
    } else if (result.streetChanged) {
      // 演出待ち → カード表示 → 確認時間 → 次アクション（async、fire-and-forget）
      this.handleStreetTransition().catch(e => console.error('handleStreetTransition error:', e));
    } else {
      // 次のアクション要求後に状態をブロードキャスト（pendingActionがセットされている状態で送信するため）
      this.requestNextAction();
      this.broadcastGameState();
    }

    return true;
  }

  /**
   * ストリート変更時の演出待ち（アクション演出 → カード表示 → 確認時間 → 次アクション）
   */
  private async handleStreetTransition(): Promise<void> {
    // アクション演出待ち（チップ移動等）
    await new Promise<void>(resolve => { setTimeout(resolve, TABLE_CONSTANTS.ACTION_ANIMATION_DELAY_MS); });

    if (!this.gameState || this.gameState.isHandComplete) return;

    // Stud: ストリート変更時に新しいホールカード（7th streetの裏カード等）を送信
    this.variantAdapter.broadcastStreetChangeCards(
      this.gameState,
      this.playerManager.getSeats(),
      this.broadcast,
      (seatIndex) => this.emitHoleCardsToSpectators(seatIndex),
    );
    this.broadcastGameState();

    // プレイヤーがカードを確認できるよう遅延
    await new Promise<void>(resolve => { setTimeout(resolve, TABLE_CONSTANTS.STREET_TRANSITION_DELAY_MS); });

    if (!this.gameState || this.gameState.isHandComplete) return;

    this.requestNextAction();
    this.broadcastGameState();
  }

  /**
   * ファストフォールド用: ターン前にフォールドして即座にテーブル移動可能にする
   * BBはプリフロップでチェックできる場合はファストフォールドできない（レイズされていればOK）
   */
  public handleEarlyFold(odId: string): boolean {
    if (!this.gameState || this.gameState.isHandComplete || this.isRunOutInProgress) {
      // FastFold連打のレースで起きるため info レベル
      console.log(`[Table ${this.id}] handleEarlyFold rejected: odId=${odId}, gameState=${!this.gameState ? 'null' : 'exists'}, isHandComplete=${this.gameState?.isHandComplete}, isRunOutInProgress=${this.isRunOutInProgress}`);
      return false;
    }

    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    const player = this.gameState.players[seatIndex];
    if (!player || player.folded || player.isAllIn) return false;

    // 既に保留中のフォールドがある場合は無視
    if (this.pendingEarlyFolds.has(seatIndex)) return false;

    // BBはプリフロップでチェックできる場合はファストフォールドできない（レイズされていればOK）
    const toCall = this.gameState.currentBet - player.currentBet;
    if (player.position === 'BB' && this.gameState.currentStreet === 'preflop' && toCall === 0) {
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
      isPrivate: this.isPrivate,
      variant: this.currentVariant,
      isHorse: this.isHorse,
    };
  }

  /**
   * ブラインドを動的に変更する（トーナメントのレベル進行用）
   * ハンド中は即座に反映されず、次のハンドから適用される
   */
  public updateBlinds(newBlinds: string): void {
    const [sb, bb, ante] = newBlinds.split('/').map(Number);
    const anteValue = ante || 0;
    if (isNaN(sb) || isNaN(bb) || sb < 0 || bb < 0 || (bb <= 0 && anteValue <= 0)) {
      console.error(`[Table ${this.id}] updateBlinds: invalid format "${newBlinds}"`);
      return;
    }
    this.blinds = newBlinds;
    this.smallBlind = sb;
    this.bigBlind = bb;
    this.ante = anteValue;
    console.log(`[Table ${this.id}] Blinds updated to ${newBlinds}`);
  }

  /**
   * 切断プレイヤーの再接続: ソケットを更新し、状態を再送信する
   * トーナメントの切断復帰で使用
   */
  public reconnectPlayer(odId: string, socket: Socket): boolean {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return false;

    const seat = this.playerManager.getSeat(seatIndex);
    if (!seat) return false;

    // ソケット更新
    seat.socket = socket;
    socket.join(this.roomName);

    // 現在のゲーム状態を再送信
    socket.emit('table:joined', { tableId: this.id, seat: seatIndex });

    // startNewHand と同じ順序で hole_cards → game:state を送る
    if (this.gameState && !this.gameState.isHandComplete) {
      const holeCards = this.gameState.players[seatIndex]?.holeCards;
      if (holeCards && holeCards.length > 0) {
        this.broadcast.emitToSocket(socket, odId, 'game:hole_cards', { cards: holeCards, seatIndex });
      }
    }
    socket.emit('game:state', { state: this.getClientGameState() });

    return true;
  }

  /**
   * プレイヤーのチップ数を取得（テーブル移動時に使用）
   */
  public getPlayerChips(odId: string): number | null {
    const seatIndex = this.playerManager.findSeatByOdId(odId);
    if (seatIndex === -1) return null;

    // ハンド中（未完了）はgameStateの値が最新
    if (this.gameState && this.gameState.players[seatIndex] && !this.gameState.isHandComplete) {
      return this.gameState.players[seatIndex].chips;
    }

    // ハンド完了後・ハンド外はseatの値を返す
    const seat = this.playerManager.getSeat(seatIndex);
    return seat?.chips ?? null;
  }

  /**
   * 指定席の有効アクションを返す（テスト・デバッグ用）
   */
  public getValidActionsForSeat(seatIndex: number): { action: string; minAmount: number; maxAmount: number }[] {
    if (!this.gameState) return [];
    return this.variantAdapter.getValidActions(this.gameState, seatIndex);
  }

  public getClientGameState(): ClientGameState {
    // 現プレイヤーのvalidActionsを計算
    const va = this.gameState && !this.gameState.isHandComplete && this.gameState.currentPlayerIndex >= 0
      ? this.variantAdapter.getValidActions(this.gameState, this.gameState.currentPlayerIndex)
      : null;
    return StateTransformer.toClientGameState(
      this.id,
      this.playerManager.getSeats(),
      this.gameState,
      this.actionController.getPendingAction(),
      this.isHandInProgress,
      this.smallBlind,
      this.bigBlind,
      va
    );
  }

  public getSpectatorCount(): number {
    return this.spectators.size;
  }

  /** 観戦者へ着席者と同タイミングでホールを席単位で送る */
  private emitHoleCardsToSpectators(_seatIndex: number): void {
    // 一旦、観戦モードでの全員カード送信は無効化
    // if (this.spectators.size === 0 || !this.gameState) return;
    // const player = this.gameState.players[_seatIndex] ?? null;
    // const cards = player?.holeCards ?? [];
    // if (cards.length === 0) return;
    // const payload = { seatIndex: _seatIndex, cards };
    // for (const sock of this.spectators.values()) {
    //   sock.emit('game:hole_cards', payload);
    // }
  }

  public addSpectator(socket: Socket): { ok: true } | { ok: false; message: string } {
    if (this.isFastFold) {
      return { ok: false, message: 'Fast foldテーブルは観戦できません' };
    }
    const atCap =
      this.spectators.size >= TABLE_CONSTANTS.MAX_SPECTATORS_PER_TABLE && !this.spectators.has(socket.id);
    if (atCap) {
      return { ok: false, message: '観戦者が上限に達しています' };
    }
    if (!this.spectators.has(socket.id)) {
      this.spectators.set(socket.id, socket);
      socket.join(this.roomName);
    }
    return { ok: true };
  }

  public removeSpectator(socket: Socket): void {
    if (!this.spectators.has(socket.id)) return;
    this.spectators.delete(socket.id);
    socket.leave(this.roomName);
  }

  /** 卓削除時など: 全観戦者をルームから外す */
  public disconnectAllSpectators(message: string): void {
    for (const s of this.spectators.values()) {
      try {
        s.emit('table:error', { message });
        s.leave(this.roomName);
      } catch {
        /* ignore */
      }
    }
    this.spectators.clear();
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

  /**
   * 切断・タイムアウト時のデフォルトアクションを決定
   * Studのブリングインフェーズでは fold が無効なため、最低コストの有効アクションを選択
   */
  private getDefaultDisconnectAction(seatIndex: number): { action: Action; amount: number; discardIndices?: number[] } {
    if (!this.gameState) return { action: 'fold', amount: 0 };

    // Draw: ドローフェーズ → stand pat（0枚交換）
    if (getVariantConfig(this.variant).family === 'draw' && isDrawStreet(this.gameState.currentStreet)) {
      return { action: 'draw', amount: 0, discardIndices: [] };
    }

    const validActions = this.variantAdapter.getValidActions(this.gameState, seatIndex);

    // チェック可能 → チェック
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // フォールド可能 → フォールド
    const foldAction = validActions.find(a => a.action === 'fold');
    if (foldAction) return { action: 'fold', amount: 0 };

    // どちらも無効（Studブリングインフェーズ等）→ 最低コストのコール
    const callAction = validActions.find(a => a.action === 'call');
    if (callAction) return { action: 'call', amount: callAction.minAmount };

    // フォールバック: 有効アクションの最小コスト
    if (validActions.length > 0) {
      const cheapest = validActions[0];
      return { action: cheapest.action, amount: cheapest.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }

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

  private _minPlayersToStart: number | null = null;

  public setMinPlayersToStart(n: number): void {
    this._minPlayersToStart = n;
  }

  private get minPlayersToStart(): number {
    if (this._minPlayersToStart !== null) return this._minPlayersToStart;
    if (this.isPrivate) return 2;
    return this.isFastFold ? TABLE_CONSTANTS.MAX_PLAYERS : TABLE_CONSTANTS.MIN_PLAYERS_TO_START;
  }

  /** HORSE: オービット完了時にバリアントを切り替え */
  private advanceHorseVariantIfNeeded(): void {
    if (!this.isHorse) return;

    // 初回 or オービット完了
    if (this.horseHandsPerRound === 0 || this.horseHandCount >= this.horseHandsPerRound) {
      if (this.horseHandsPerRound > 0) {
        // 次のバリアントへ
        this.horseCurrentIndex = (this.horseCurrentIndex + 1) % this.horseVariants.length;
      }
      this.horseHandCount = 0;
      this.horseHandsPerRound = this.getPlayerCount();

      const newVariant = this.horseVariants[this.horseCurrentIndex];
      this.variantAdapter = new VariantAdapter(newVariant);
      const rakeOpts = this.gameMode === 'tournament' ? { rakePercent: 0, rakeCapBB: 0 } : undefined;
      this.actionController = new ActionController(this.broadcast, this.variantAdapter, rakeOpts);

    }

    this.horseHandCount++;
  }

  /** HORSE: 現在のバリアント（外部から参照用） */
  public get currentVariant(): GameVariant {
    if (this.isHorse) {
      return this.horseVariants[this.horseCurrentIndex];
    }
    return this.variant;
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
    this.allInStreetCardCount = null;
    this.pendingEarlyFolds.clear(); // safety

    // HORSE: バリアントローテーション
    if (this.isHorse) {
      this.advanceHorseVariantIfNeeded();
    }

    // Create initial game state。bomb pot は bb=0 なので buy-in 計算には ante を使う。
    const buyInBase = this.bigBlind > 0 ? this.bigBlind : this.ante;
    const buyInChips = buyInBase * TABLE_CONSTANTS.DEFAULT_BUYIN_MULTIPLIER;
    this.gameState = this.variantAdapter.createGameState(buyInChips, this.smallBlind, this.bigBlind, this.ante);
    // トナメは最小チップ単位 100。ポット分配で 100 未満の端数が出ないようにする
    if (this.gameMode === 'tournament') {
      this.gameState.chipUnit = 100;
    }

    // Restore dealer position (startNewHand will increment it)
    if (this.lastDealerPosition >= 0) {
      this.gameState.dealerPosition = this.lastDealerPosition;
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

    // ハンドヒストリー用スナップショット記録 (startHand を呼ぶ前に取る:
    // ブラインド/アンテ徴収前の chips と、このハンドで適用される blinds 文字列を保存。
    // bomb pot のように totalBetThisRound に乗らない徴収方式でも startChips が
    // 正しく開始時の値になり、Result の profit が「自分の投資を引いた純利益」になる)
    this.historyRecorder.recordHandStart(seats, this.gameState, this.blinds);

    // Start the hand (this will increment dealerPosition and update positions)
    this.gameState = this.variantAdapter.startHand(this.gameState);
    this.lastDealerPosition = this.gameState.dealerPosition;

    // ブラインド投入でオールインになったプレイヤーがいれば記録（プリフロップ = 0枚）
    if (this.gameState.players.some(p => p.isAllIn)) {
      this.allInStreetCardCount = 0;
    }

    // ホール配布: 着席者へはソケットがある相手のみ。観戦者へはソケット無し席（CPU等）も含め全参加席分送る。
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      const holeCards = this.gameState.players[i].holeCards;
      if (holeCards.length === 0) continue;
      if (!seat || seat.waitingForNextHand) continue;

      if (seat.socket) {
        const holeCardsData = { cards: holeCards, seatIndex: i };
        this.broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', holeCardsData);
      }
      this.emitHoleCardsToSpectators(i);
    }

    // bomb pot: 全員がアンテで all-in になり startBombPotHand が即ランアウト
    // → showdown 状態で返ってくるケース。requestNextAction は isHandComplete を
    // 見て早期 return するため、ここで明示的にランアウト演出経由で
    // handleHandComplete に到達させないと次ハンドが永久に始まらない。
    if (this.gameState.isHandComplete) {
      this.handleAllInRunOut(this.gameState, 0).catch(e => console.error('handleAllInRunOut error (start-of-hand showdown):', e));
      return;
    }

    // bomb pot: ホール配布 → 1 秒待ち → フロップ公開、の演出を挟む。
    // 中間 state では boards を空・currentStreet='preflop'・currentPlayerIndex=-1 にして、
    // 1 秒後に本物の state（フロップ込）を流すことで、クライアントの street 差分検出
    // (preflop → flop) が後続の 3 枚を新カードとして拾い、既存のフリップ演出に乗る。
    if (this.gameState.variant === 'plo_double_board_bomb') {
      const realState = this.gameState;
      const dealState: GameState = JSON.parse(JSON.stringify(realState));
      dealState.boards = [[], []];
      dealState.communityCards = [];
      dealState.currentStreet = 'preflop';
      dealState.currentPlayerIndex = -1;
      this.gameState = dealState;
      this.broadcastGameState();
      this.handleBombPotInitialReveal(realState).catch(e => console.error('handleBombPotInitialReveal error:', e));
      return;
    }

    // Request first action then broadcast (so pendingAction is set)
    this.requestNextAction();
    this.broadcastGameState();
  }

  /**
   * DBBP のハンド開始時、ホール配布だけが見える中間 state を流したあと、
   * 1 秒待ってフロップ込みの本物 state に差し替えて再ブロードキャストする。
   * 戻し時に boards が 0 → 3 になるので、クライアントは既存の新カード演出に乗る。
   */
  private async handleBombPotInitialReveal(realState: GameState): Promise<void> {
    await new Promise<void>(resolve => { setTimeout(resolve, TABLE_CONSTANTS.BOMB_POT_FLOP_REVEAL_DELAY_MS); });

    if (!this.gameState || this.gameState.isHandComplete) return;

    this.gameState = realState;
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

    // currentPlayer がオールインの場合はスキップして次へ進む
    // （ブラインド投入でオールインになったケースなど）
    const currentPlayer = this.gameState.players[this.gameState.currentPlayerIndex];
    if (currentPlayer && currentPlayer.isAllIn) {
      this.advanceToNextPlayer();
      return;
    }

    // Pending early fold: 手番が回ってきたプレイヤーの保留フォールドを処理
    // handleAction → applyAction('fold') で正規のフォールド処理を行う
    // handleAction 内で requestNextAction が再帰的に呼ばれ、連続する pending fold も処理される
    if (this.pendingEarlyFolds.has(this.gameState.currentPlayerIndex)) {
      const seatIndex = this.gameState.currentPlayerIndex;
      const odId = this.pendingEarlyFolds.get(seatIndex)!;
      this.pendingEarlyFolds.delete(seatIndex);
      // drawストリート等ではfoldが無効なため、デフォルトアクションを使用
      const defaultAction = this.getDefaultDisconnectAction(seatIndex);
      this.handleAction(odId, defaultAction.action, defaultAction.amount, defaultAction.discardIndices);
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
        // 切断済みプレイヤー: 有効なデフォルトアクションで正規処理
        if (!this.gameState) return;
        const idx = this.gameState.currentPlayerIndex;
        const seat = this.playerManager.getSeat(idx);
        if (seat?.odId) {
          const defaultAction = this.getDefaultDisconnectAction(idx);
          const handled = this.handleAction(seat.odId, defaultAction.action, defaultAction.amount, defaultAction.discardIndices, 'auto');
          if (!handled && this.gameState && !this.gameState.isHandComplete && this.gameState.currentPlayerIndex === idx) {
            // handleAction 失敗時のリカバリー: 強制フォールドして進行
            console.error(`[Table ${this.id}] Disconnected fold failed, forcing advance. seat=${idx}`);
            const p = this.gameState.players[idx];
            if (p && !p.folded) p.folded = true;
            this.actionController.clearTimers();
            this.advanceToNextPlayer();
          }
        }
      }
    );
  }

  private async handleActionTimeout(playerId: string, seatIndex: number): Promise<void> {
    console.warn(`[Table ${this.id}] Action timeout: playerId=${playerId}, seat=${seatIndex}`);

    if (!this.gameState) {
      console.error(`[Table ${this.id}] Action timeout but no gameState: playerId=${playerId}, seat=${seatIndex}`);
      this.actionController.clearTimers();
      return;
    }

    // Check if player is still at the table
    const seat = this.playerManager.getSeat(seatIndex);
    if (seat && seat.odId === playerId) {
      // タイムアウト記録（短縮ペナルティ用）
      this.playerManager.incrementConsecutiveTimeouts(seatIndex);

      // チェック可能ならチェック、フォールド可能ならフォールド、それ以外は最低コストアクション
      const defaultAction = this.getDefaultDisconnectAction(seatIndex);
      const handled = this.handleAction(playerId, defaultAction.action, defaultAction.amount, defaultAction.discardIndices, 'auto');

      if (!handled) {
        // handleAction が失敗した場合のリカバリー: 強制フォールドして進行
        console.error(`[Table ${this.id}] Action timeout: handleAction failed, forcing advance. playerId=${playerId}, seat=${seatIndex}, action=${defaultAction.action}`);
        if (this.gameState && !this.gameState.isHandComplete && this.gameState.currentPlayerIndex === seatIndex) {
          const p = this.gameState.players[seatIndex];
          if (p && !p.folded) p.folded = true;
          this.actionController.clearTimers();
          this.advanceToNextPlayer();
        }
      }

      // ファストフォールド: タイムアウトフォールド後にテーブル移動
      if (defaultAction.action === 'fold' && handled && this.isFastFold && seat.socket && this.onTimeoutFold) {
        await this.onTimeoutFold(playerId, seat.socket);
      }
    } else {
      // Player already left, but game might be stuck - advance if needed
      if (!this.gameState.isHandComplete &&
          this.gameState.currentPlayerIndex === seatIndex) {
        // Game is stuck waiting for this player, advance
        const p = this.gameState.players[seatIndex];
        if (p && !p.folded) p.folded = true;
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
    console.log(`[Table ${this.id}] handleAllInRunOut: previousCardCount=${previousCardCount}`);

    const isBombPot = finalState.variant === 'plo_double_board_bomb' && finalState.boards?.length === 2;

    // ランアウト前のボードでEV計算（エクイティベース）
    // bomb pot は 2 ボード前提で equity 計算式が異なるため、ここではスキップ。
    if (!isBombPot) {
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
        console.log(`[Table ${this.id}] All-in EV profits:`, Object.fromEntries(evProfits));
      } catch (err) {
        console.error(`[Table ${this.id}] EV calculation failed:`, err);
      }
    }

    const allCards = [...finalState.communityCards];
    // bomb pot では board 1 / board 2 の最終形を別々に保持（並列ランアウト用）
    const finalBoards = isBombPot ? finalState.boards!.map(b => [...b]) : null;

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
        // winners[].handName は単一ボード/単一側の部分情報（例: bomb pot の "Board X: ..."、
        // Hi-Lo のロー単独勝ちで "6-low" のみ）なので、全プレイヤーで evaluateHandName を呼んで
        // 完全形（"B1: ... / B2: ..." や "Hi / Lo"）に揃える。
        const handName = isBombPot
          ? this.variantAdapter.evaluateHandName(p, finalState.communityCards, finalBoards!)
          : this.variantAdapter.evaluateHandName(p, finalState.communityCards);
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

      await new Promise<void>(resolve => { setTimeout(resolve, TABLE_CONSTANTS.SHOWDOWN_DELAY_MS); });

      this.broadcast.emitToRoom('game:showdown', showdownData);
      this.showdownSentDuringRunOut = true;

      await new Promise<void>(resolve => { setTimeout(resolve, TABLE_CONSTANTS.SHOWDOWN_DELAY_MS); });
    }

    // ランアウト中の中間状態用: 分配前のチップとポットを計算
    // bomb pot は同一プレイヤーが両ボードで勝つと winners[] に複数エントリが入るため
    // find でなく合計を引く必要がある。
    const preDistributionChips = finalState.players.map(p => {
      const wonTotal = finalState.winners
        .filter(w => w.playerId === p.id)
        .reduce((sum, w) => sum + w.amount, 0);
      return p.chips - wonTotal;
    });
    const preDistributionPot = finalState.winners.reduce((sum, w) => sum + w.amount, 0) + finalState.rake;

    let currentStageIndex = 0;

    const revealNextStage = async() => {
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
      if (isBombPot && finalBoards) {
        // 2 ボードを並列に開示（同じ枚数まで両方を見せる）
        intermediateState.boards = [
          finalBoards[0].slice(0, stage.cardCount),
          finalBoards[1].slice(0, stage.cardCount),
        ];
        intermediateState.communityCards = intermediateState.boards[0];
      } else {
        intermediateState.communityCards = allCards.slice(0, stage.cardCount);
      }
      intermediateState.isHandComplete = false;
      intermediateState.winners = [];
      intermediateState.currentStreet = stage.street;
      intermediateState.currentPlayerIndex = -1;

      // チップを分配前の状態に戻す（ボード完了前に結果がわからないようにする）
      for (let i = 0; i < intermediateState.players.length; i++) {
        intermediateState.players[i].chips = preDistributionChips[i];
      }
      intermediateState.pot = preDistributionPot;
      intermediateState.rake = 0;

      this.gameState = intermediateState;
      this.broadcastGameState();

      currentStageIndex++;

      await new Promise(resolve => setTimeout(resolve, TABLE_CONSTANTS.RUNOUT_STREET_DELAY_MS));
      
      await revealNextStage();
    };

    // 最初のステージを即座に表示開始
    await revealNextStage();
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

    // 部分オールイン時のEV計算: handleAllInRunOut を経由しなかった場合
    // （例: Turnでオールインしたが他プレイヤーがアクティブのままリバーまで進んだケース）
    // bomb pot は 2 ボード前提で式が異なるためスキップ
    const isBombPotForEV = this.gameState.variant === 'plo_double_board_bomb';
    if (!isBombPotForEV && !this.showdownSentDuringRunOut && this.allInStreetCardCount !== null && this.allInStreetCardCount < 5) {
      try {
        const priorBoard = this.gameState.communityCards.slice(0, this.allInStreetCardCount);
        const allPots = calculateSidePots(this.gameState.players);
        const totalBets = new Map<number, number>();
        const allPlayerInfo = this.gameState.players.map(p => {
          totalBets.set(p.id, p.totalBetThisRound);
          return { playerId: p.id, holeCards: p.holeCards, folded: p.folded || p.isSittingOut };
        });
        const evProfits = calculateAllInEVProfits(priorBoard, allPlayerInfo, allPots, totalBets);
        this.historyRecorder.setAllInEVProfits(evProfits);
        console.log(`[Table ${this.id}] Partial all-in EV profits (board=${this.allInStreetCardCount} cards):`, Object.fromEntries(evProfits));
      } catch (err) {
        console.error(`[Table ${this.id}] Partial all-in EV calculation failed:`, err);
      }
    }

    // ハンドヒストリー保存 (fire-and-forget)
    // fire-and-forgetのため、非同期処理中に次のハンドで状態が上書きされないようスナップショットを取る
    const seatsSnapshot = this.playerManager.getSeats().map(s => s ? { ...s } : null);
    const gameStateSnapshot: GameState = {
      ...this.gameState,
      players: this.gameState.players.map(p => ({ ...p, holeCards: [...p.holeCards] })),
      communityCards: [...this.gameState.communityCards],
      winners: [...this.gameState.winners],
      handHistory: [...this.gameState.handHistory],
    };
    this.historyRecorder.recordHandComplete(
      this.id,
      gameStateSnapshot,
      seatsSnapshot
    ).catch(err => console.error('Hand history save failed:', err));

    // Showdown - reveal cards for ALL active players (showdownをhand_completeより先に送信)
    // ランアウト時は handleAllInRunOut() で既に送信済みなのでスキップ
    const seats = this.playerManager.getSeats();
    if (this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1 && !this.showdownSentDuringRunOut) {
      const activePlayers = getActivePlayers(this.gameState);
      const isBombPot = this.gameState.variant === 'plo_double_board_bomb' && this.gameState.boards?.length === 2;
      const showdownPlayers = activePlayers.map(p => {
        const handName = isBombPot
          ? this.variantAdapter.evaluateHandName(p, this.gameState!.communityCards, this.gameState!.boards)
          : this.variantAdapter.evaluateHandName(p, this.gameState!.communityCards);
        return {
          seatIndex: p.id,
          odId: seats[p.id]?.odId || '',
          cards: this.variantAdapter.getShowdownCards(p),
          handName,
        };
      });
      const showdownData = {
        winners: this.gameState.winners.map(w => ({
          playerId: seats[w.playerId]?.odId || '',
          amount: w.amount,
          handName: w.handName,
          cards: this.gameState!.players[w.playerId].holeCards,
          ...(w.hiLoType ? { hiLoType: w.hiLoType } : {}),
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
        ...(w.hiLoType ? { hiLoType: w.hiLoType } : {}),
      })),
      rake: this.gameState.rake,
    };
    this.broadcast.emitToRoom('game:hand_complete', handCompleteData);

    // Update seat chips
    const settledChips: { odId: string; seatIndex: number; chips: number }[] = [];
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      // waitingForNextHandのプレイヤーはハンドに参加していないのでチップを上書きしない
      if (seat && this.gameState.players[i] && !seat.waitingForNextHand) {
        this.playerManager.updateChips(i, this.gameState.players[i].chips);
        settledChips.push({ odId: seat.odId, seatIndex: i, chips: this.gameState.players[i].chips });
      }
    }

    // ハンド完了後の状態をブロードキャスト
    this.broadcastGameState();

    // pendingStartHand を先に設定してから isHandInProgress を解除する。
    // 逆順だと、onHandSettled コールバック内で triggerMaybeStartHand() が呼ばれた際に
    // 両方のガードが外れた状態になり、ハンドが二重起動する。
    this.pendingStartHand = true;
    this._isHandInProgress = false;

    // チップ精算コールバック（トーナメント等での外部同期用）
    // NOTE: isHandInProgress を先に false にしてからコールバックを呼ぶ。
    // トーナメントの scheduleFormFinalTable / checkAndExecuteBalance が
    // このテーブルを「ハンド中」と誤判定しないようにするため。
    if (this.lifecycleCallbacks.onHandSettled && settledChips.length > 0) {
      this.lifecycleCallbacks.onHandSettled(settledChips);
    }

    // 待ち時間
    // ショーダウンかどうかを記録（次ハンド開始までの待ち時間に影響）
    const wasShowdown = this.gameState.currentStreet === 'showdown' && getActivePlayers(this.gameState).length > 1;
    // ショーダウン時はカードを確認する時間を長めに取る
    const delay = wasShowdown ? TABLE_CONSTANTS.NEXT_HAND_SHOWDOWN_DELAY_MS : TABLE_CONSTANTS.NEXT_HAND_DELAY_MS;
    await new Promise(resolve => setTimeout(resolve, delay));

    // Remove busted players and players who left during hand
    const startChipsBySeat = this.historyRecorder.getStartChips();
    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (!seat) continue;
      if (seat.leftForFastFold) {
        this.playerManager.unseatPlayer(i);
      } else if (seat.chips <= 0) {
        // コールバックでバスト処理を委譲（キャッシュ/トーナメントで挙動が異なる）
        const chipsAtHandStart = startChipsBySeat.get(i) ?? 0;
        const shouldUnseat = this.lifecycleCallbacks.onPlayerBusted(
          seat.odId,
          i,
          seat.socket,
          chipsAtHandStart
        );
        if (shouldUnseat) {
          this.unseatPlayer(seat.odId);
        }
      }
    }
    // バスト処理完了コールバック（トーナメント: 順位確定・フェーズ遷移）
    if (this.lifecycleCallbacks.onBustsProcessed) {
      this.lifecycleCallbacks.onBustsProcessed();
    }

    // 結果表示の待ち時間が終わってから、テーブル移動など卓外の調整を許可する。
    if (this.lifecycleCallbacks.onHandPresentationComplete) {
      this.lifecycleCallbacks.onHandPresentationComplete();
    }

    this.pendingStartHand = false;

    // isHandInProgress=false の状態をブロードキャスト（待機中UIの表示に必要）
    this.broadcastGameState();

    // ハンド終了後のGameStateをクリア（前ハンドのcommunityCards等が残らないように）
    this.gameState = null;

    // ファストフォールド: 残り全プレイヤーを新テーブルに再割り当て
    if (this.isFastFold && this.onFastFoldReassign) {
      const playersToMove: { odId: string; chips: number; socket: Socket; odName: string; displayName?: string | null; avatarUrl: string | null; nameMasked: boolean; hasWeeklyChampion?: boolean }[] = [];
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
            hasWeeklyChampion: seat.hasWeeklyChampion,
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
    const clientState = this.getClientGameState();
    this.broadcast.emitToRoom('game:state', { state: clientState });
  }

}
