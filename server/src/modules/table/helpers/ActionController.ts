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

export class ActionController {
  private actionTimer: NodeJS.Timeout | null = null;
  private pendingAction: PendingAction | null = null;
  private actionGeneration = 0;

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
    this.actionGeneration++;
    if (this.actionTimer) {
      clearTimeout(this.actionTimer);
      this.actionTimer = null;
    }
    this.pendingAction = null;
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
    let nextIndex = (gameState.currentPlayerIndex + 1) % TABLE_CONSTANTS.MAX_PLAYERS;
    let attempts = 0;

    while (attempts < TABLE_CONSTANTS.MAX_PLAYERS) {
      const player = gameState.players[nextIndex];
      const seat = seats[nextIndex];
      // waitingForNextHandのプレイヤーはスキップ
      if (player && !player.folded && !player.isAllIn && seat && !seat.waitingForNextHand) {
        break;
      }
      nextIndex = (nextIndex + 1) % TABLE_CONSTANTS.MAX_PLAYERS;
      attempts++;
    }

    // 全員アクション不可なら勝者決定
    if (attempts >= TABLE_CONSTANTS.MAX_PLAYERS) {
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

    const timeoutMs = gameState.currentStreet === 'preflop'
      ? TABLE_CONSTANTS.ACTION_TIMEOUT_PREFLOP_MS
      : TABLE_CONSTANTS.ACTION_TIMEOUT_POSTFLOP_MS;

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
    };

    // タイムアウトタイマー設定（世代カウンターで古いコールバックを無視）
    const playerIdForTimeout = currentSeat.odId;
    const seatIndexForTimeout = currentPlayerIndex;
    const gen = ++this.actionGeneration;

    this.actionTimer = setTimeout(() => {
      if (this.actionGeneration !== gen) return;
      onTimeout(playerIdForTimeout, seatIndexForTimeout);
    }, timeoutMs);
  }

}
