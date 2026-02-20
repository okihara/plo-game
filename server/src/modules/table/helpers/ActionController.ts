// アクションフロー制御・タイマー管理

import { GameState, Action } from '../../../shared/logic/types.js';
import { getValidActions, getActivePlayers, applyAction, determineWinner, wouldAdvanceStreet, type RakeConfig } from '../../../shared/logic/gameEngine.js';
import { SeatInfo, PendingAction } from '../types.js';
import { TABLE_CONSTANTS } from '../constants.js';
import { BroadcastService } from './BroadcastService.js';

export interface ActionResult {
  success: boolean;
  gameState: GameState;
  streetChanged: boolean;
  handComplete: boolean;
}

export interface AdvanceResult {
  gameState: GameState;
  nextIndex: number;
  handComplete: boolean;
}

export class ActionController {
  private actionTimer: NodeJS.Timeout | null = null;
  private streetTransitionTimer: NodeJS.Timeout | null = null;
  private pendingAction: PendingAction | null = null;
  private actionGeneration = 0;

  constructor(private broadcast: BroadcastService) {}

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
    if (this.streetTransitionTimer) {
      clearTimeout(this.streetTransitionTimer);
      this.streetTransitionTimer = null;
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
    rakeConfig?: RakeConfig
  ): ActionResult {
    // プレイヤーのターンかチェック
    if (gameState.currentPlayerIndex !== seatIndex) {
      return { success: false, gameState, streetChanged: false, handComplete: false };
    }

    // バリデーション
    const validActions = getValidActions(gameState, seatIndex);
    const isValid = validActions.some(a =>
      a.action === action &&
      (action === 'fold' || action === 'check' || (amount >= a.minAmount && amount <= a.maxAmount))
    );

    if (!isValid) {
      return { success: false, gameState, streetChanged: false, handComplete: false };
    }

    // タイマークリア
    this.clearActionTimer();

    // ストリート変更を事前検出（applyAction前に判定）
    const willAdvanceStreet = wouldAdvanceStreet(gameState, seatIndex, action, amount);

    // アクション適用
    const newState = applyAction(gameState, seatIndex, action, amount, rakeConfig);

    // アクションをブロードキャスト（ストリート変更情報付き）
    this.broadcast.emitToRoom('game:action_taken', {
      playerId: odId,
      action,
      amount,
      streetChanged: willAdvanceStreet,
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
    seats: (SeatInfo | null)[],
    rakeConfig?: RakeConfig
  ): AdvanceResult {
    const activePlayers = getActivePlayers(gameState);

    // 1人以下なら勝者決定
    if (activePlayers.length <= 1) {
      const newState = determineWinner(gameState, rakeConfig);
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
      const newState = determineWinner(gameState, rakeConfig);
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
    if (!currentSeat || !currentSeat.socket) {
      onDisconnectedFold();
      return;
    }

    const validActions = getValidActions(gameState, currentPlayerIndex);

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
      timeoutMs: TABLE_CONSTANTS.ACTION_TIMEOUT_MS,
    };

    // アクション要求を送信
    this.broadcast.emitToSocket(
      currentSeat.socket,
      currentSeat.odId,
      'game:action_required',
      {
        playerId: currentSeat.odId,
        validActions,
        timeoutMs: TABLE_CONSTANTS.ACTION_TIMEOUT_MS,
      }
    );

    // タイムアウトタイマー設定（世代カウンターで古いコールバックを無視）
    const playerIdForTimeout = currentSeat.odId;
    const seatIndexForTimeout = currentPlayerIndex;
    const gen = ++this.actionGeneration;

    this.actionTimer = setTimeout(() => {
      if (this.actionGeneration !== gen) return;
      onTimeout(playerIdForTimeout, seatIndexForTimeout);
    }, TABLE_CONSTANTS.ACTION_TIMEOUT_MS);
  }

  /**
   * アクション演出待ちの遅延処理（ストリート変更前の一拍）
   */
  scheduleActionAnimation(callback: () => void): void {
    if (this.streetTransitionTimer) {
      clearTimeout(this.streetTransitionTimer);
    }
    this.streetTransitionTimer = setTimeout(() => {
      this.streetTransitionTimer = null;
      callback();
    }, TABLE_CONSTANTS.ACTION_ANIMATION_DELAY_MS);
  }

  /**
   * ストリート遷移の遅延処理（コミュニティカード確認時間）
   */
  scheduleStreetTransition(callback: () => void): void {
    if (this.streetTransitionTimer) {
      clearTimeout(this.streetTransitionTimer);
    }
    this.streetTransitionTimer = setTimeout(() => {
      this.streetTransitionTimer = null;
      callback();
    }, TABLE_CONSTANTS.STREET_TRANSITION_DELAY_MS);
  }
}
