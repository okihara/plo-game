// アクションフロー制御・タイマー管理

import { GameState, Action } from '../../../shared/logic/types.js';
import { getActivePlayers } from '../../../shared/logic/gameEngine.js';
import { SeatInfo, PendingAction } from '../types.js';
import { TABLE_CONSTANTS } from '../constants.js';
import { BroadcastService } from './BroadcastService.js';
import { VariantAdapter } from './VariantAdapter.js';

export interface ActionResult {
  success: boolean;
  gameState: GameState;
  streetChanged: boolean;
  handComplete: boolean;
  rejectReason?: string;
}

export interface AdvanceResult {
  gameState: GameState;
  nextIndex: number;
  handComplete: boolean;
}

/**
 * ポーズで止めた手番。pendingAction のスナップショット（timeoutMs は残り時間に置換済み、
 * totalTimeoutMs は元の持ち時間のまま）と、再開時に張り直すタイムアウトコールバックを保持する。
 */
interface PausedTurn {
  pendingAction: PendingAction;
  onTimeout: (playerId: string, seatIndex: number) => void;
}

export class ActionController {
  private actionTimer: NodeJS.Timeout | null = null;
  private pendingAction: PendingAction | null = null;
  private actionGeneration = 0;
  /** 現在の手番に対して張ったタイムアウトコールバック（ポーズ再開時に再利用） */
  private currentOnTimeout: ((playerId: string, seatIndex: number) => void) | null = null;
  /** ポーズで止めた手番。再開時にこの残り時間でタイマーを張り直す。 */
  private pausedTurn: PausedTurn | null = null;

  private rakePercent: number;
  private rakeCapBB: number;

  constructor(private broadcast: BroadcastService, private variantAdapter: VariantAdapter, options?: { rakePercent?: number; rakeCapBB?: number }) {
    this.rakePercent = options?.rakePercent ?? TABLE_CONSTANTS.RAKE_PERCENT;
    this.rakeCapBB = options?.rakeCapBB ?? TABLE_CONSTANTS.RAKE_CAP_BB;
  }

  getPendingAction(): PendingAction | null {
    return this.pendingAction;
  }

  /**
   * 全タイマーをクリア
   */
  clearTimers(): void {
    this.clearActionTimer();
  }

  /**
   * アクションタイマーのみクリア
   */
  clearActionTimer(): void {
    this.actionGeneration++;
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.pendingAction = null;
    this.pausedTurn = null;
  }

  /**
   * 手番のタイマーを止め、残り時間を保持する（コーチング用ポーズ）。
   * 手番が立っていないタイミング（ハンド間・演出中）で呼ばれた場合は何も保持しない。
   * @returns 保持した残り時間（ms）。保持しなかった場合は null
   */
  pauseActionTimer(): number | null {
    if (!this.actionTimer || !this.pendingAction || !this.currentOnTimeout) return null;

    const elapsed = Date.now() - this.pendingAction.requestedAt;
    const remainingMs = Math.max(
      TABLE_CONSTANTS.PAUSE_RESUME_MIN_ACTION_MS,
      this.pendingAction.timeoutMs - elapsed,
    );

    // 世代を進めて、動作中のコールバックを無効化してから停止する
    this.actionGeneration++;
    clearTimeout(this.actionTimer);
    this.actionTimer = null;

    this.pausedTurn = {
      pendingAction: { ...this.pendingAction, timeoutMs: remainingMs },
      onTimeout: this.currentOnTimeout,
    };
    // ポーズ中は「待機中のアクションなし」にして、クライアントのカウントダウンを止める
    this.pendingAction = null;

    return remainingMs;
  }

  /** ポーズで止めた手番があるか */
  hasPausedTurn(): boolean {
    return this.pausedTurn !== null;
  }

  /**
   * ポーズで止めた手番のタイマーを、保持していた残り時間で張り直す。
   * @returns 再開したら true、止めていた手番が無い・席が入れ替わっていた場合は false
   */
  resumeActionTimer(seats: (SeatInfo | null)[]): boolean {
    const paused = this.pausedTurn;
    this.pausedTurn = null;
    if (!paused) return false;

    const { playerId, seatNumber, timeoutMs } = paused.pendingAction;

    // ポーズ中に離席・着席入れ替えが起きていたら再開しない（呼び出し側が仕切り直す）
    const seat = seats[seatNumber];
    if (!seat || seat.odId !== playerId) return false;

    this.pendingAction = { ...paused.pendingAction, requestedAt: Date.now() };
    this.currentOnTimeout = paused.onTimeout;

    const gen = ++this.actionGeneration;
    this.actionTimer = setTimeout(() => {
      if (this.actionGeneration !== gen) return;
      paused.onTimeout(playerId, seatNumber);
    }, timeoutMs);

    return true;
  }

  /**
   * アクションを処理
   */
  handleAction(
    gameState: GameState,
    seatIndex: number,
    action: Action,
    amount: number,
    odId: string,
    discardIndices?: number[]
  ): ActionResult {
    // プレイヤーのターンかチェック
    if (gameState.currentPlayerIndex !== seatIndex) {
      return { success: false, gameState, streetChanged: false, handComplete: false, rejectReason: `not player's turn (expected seat ${gameState.currentPlayerIndex})` };
    }

    const validActions = this.variantAdapter.getValidActions(gameState, seatIndex);
    const isValid = validActions.some(a =>
      a.action === action &&
      (action === 'fold' || action === 'check' || (amount >= a.minAmount && amount <= a.maxAmount))
    );

    if (!isValid) {
      const matching = validActions.find(a => a.action === action);
      const reason = matching
        ? `amount ${amount} out of range [${matching.minAmount}, ${matching.maxAmount}]`
        : `action '${action}' not in valid actions [${validActions.map(a => a.action).join(', ')}]`;
      return { success: false, gameState, streetChanged: false, handComplete: false, rejectReason: reason };
    }

    // タイマークリア
    this.clearActionTimer();

    // ストリート変更を事前検出（applyAction前に判定）
    const willAdvanceStreet = this.variantAdapter.wouldAdvanceStreet(gameState, seatIndex, action, amount, discardIndices);

    // アクション適用
    const newState = this.variantAdapter.applyAction(gameState, seatIndex, action, amount, this.rakePercent, this.rakeCapBB, discardIndices);

    // アクションをブロードキャスト（ストリート変更情報付き）
    this.broadcast.emitToRoom('game:action_taken', {
      playerId: odId,
      action,
      amount,
      streetChanged: willAdvanceStreet,
      ...(action === 'draw' && discardIndices ? { drawCount: discardIndices.length } : {}),
    });

    return {
      success: true,
      gameState: newState,
      streetChanged: willAdvanceStreet,
      handComplete: newState.isHandComplete,
    };
  }

  /**
   * 次のプレイヤーへ進む
   */
  advanceToNextPlayer(
    gameState: GameState,
    seats: (SeatInfo | null)[]
  ): AdvanceResult {
    const activePlayers = getActivePlayers(gameState);

    // 1人以下なら勝者決定
    if (activePlayers.length <= 1) {
      const newState = this.variantAdapter.determineWinner(gameState, this.rakePercent, this.rakeCapBB);
      return { gameState: newState, nextIndex: -1, handComplete: true };
    }

    // 次のアクティブプレイヤーを探す
    const seatCount = gameState.players.length;
    let nextIndex = (gameState.currentPlayerIndex + 1) % seatCount;
    let attempts = 0;

    while (attempts < seatCount) {
      const player = gameState.players[nextIndex];
      const seat = seats[nextIndex];
      // waitingForNextHandのプレイヤーはスキップ
      if (player && !player.folded && !player.isAllIn && seat && !seat.waitingForNextHand) {
        break;
      }
      nextIndex = (nextIndex + 1) % seatCount;
      attempts++;
    }

    // 全員アクション不可なら勝者決定
    if (attempts >= seatCount) {
      const newState = this.variantAdapter.determineWinner(gameState, this.rakePercent, this.rakeCapBB);
      return { gameState: newState, nextIndex: -1, handComplete: true };
    }

    gameState.currentPlayerIndex = nextIndex;
    return { gameState, nextIndex, handComplete: false };
  }

  /**
   * 次のアクションをリクエスト
   */
  requestNextAction(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    onTimeout: (playerId: string, seatIndex: number) => void,
    onDisconnectedFold: () => void
  ): void {
    if (gameState.isHandComplete) return;

    const currentPlayerIndex = gameState.currentPlayerIndex;

    // currentPlayerIndex が -1 の場合（全員オールインなど）
    if (currentPlayerIndex === -1) {
      return;
    }

    const currentSeat = seats[currentPlayerIndex];

    // 切断・離席済みプレイヤーの処理（FoldProcessorに委譲）
    // socket が null、または socket.connected が false（トーナメント切断プレイヤー等）の場合は即座にフォールド
    if (!currentSeat || !currentSeat.socket || !currentSeat.socket.connected) {
      onDisconnectedFold();
      return;
    }

    const validActions = this.variantAdapter.getValidActions(gameState, currentPlayerIndex);

    const baseTimeoutMs = gameState.currentStreet === 'preflop'
      ? TABLE_CONSTANTS.ACTION_TIMEOUT_PREFLOP_MS
      : TABLE_CONSTANTS.ACTION_TIMEOUT_POSTFLOP_MS;

    // 連続タイムアウトに応じて持ち時間を短縮（牛歩抑止）
    const factors = TABLE_CONSTANTS.ACTION_TIMEOUT_PENALTY_FACTORS;
    const penaltyIndex = Math.min(currentSeat.consecutiveTimeouts, factors.length - 1);
    const factor = factors[penaltyIndex];
    const timeoutMs = Math.max(
      TABLE_CONSTANTS.ACTION_TIMEOUT_MIN_MS,
      Math.round(baseTimeoutMs * factor),
    );

    // ダッシュボード用のpendingAction設定
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
      timeoutMs,
      totalTimeoutMs: timeoutMs,
    };

    // タイムアウトタイマー設定（世代カウンターで古いコールバックを無視）
    const playerIdForTimeout = currentSeat.odId;
    const seatIndexForTimeout = currentPlayerIndex;
    this.currentOnTimeout = onTimeout;
    const gen = ++this.actionGeneration;

    this.actionTimer = setTimeout(() => {
      if (this.actionGeneration !== gen) return;
      onTimeout(playerIdForTimeout, seatIndexForTimeout);
    }, timeoutMs);
  }

}
