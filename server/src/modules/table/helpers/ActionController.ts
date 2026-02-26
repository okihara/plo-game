// アクション検証・次プレイヤー探索
// タイマー管理は TimerScheduler に移動済み

import { GameState, Action } from '../../../shared/logic/types.js';
import { getValidActions, getActivePlayers, applyAction, determineWinner, wouldAdvanceStreet } from '../../../shared/logic/gameEngine.js';
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
  private pendingAction: PendingAction | null = null;

  constructor(private broadcast: BroadcastService) {}

  getPendingAction(): PendingAction | null {
    return this.pendingAction;
  }

  setPendingAction(action: PendingAction | null): void {
    this.pendingAction = action;
  }

  clearPendingAction(): void {
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
    odId: string
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

    // pendingAction をクリア（タイマーのクリアは呼び出し元の TableInstance が担当）
    this.pendingAction = null;

    // ストリート変更を事前検出（applyAction前に判定）
    const willAdvanceStreet = wouldAdvanceStreet(gameState, seatIndex, action, amount);

    // アクション適用
    const newState = applyAction(gameState, seatIndex, action, amount, TABLE_CONSTANTS.RAKE_PERCENT, TABLE_CONSTANTS.RAKE_CAP_BB);

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
    seats: (SeatInfo | null)[]
  ): AdvanceResult {
    const activePlayers = getActivePlayers(gameState);

    // 1人以下なら勝者決定
    if (activePlayers.length <= 1) {
      const newState = determineWinner(gameState);
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
      const newState = determineWinner(gameState);
      return { gameState: newState, nextIndex: -1, handComplete: true };
    }

    gameState.currentPlayerIndex = nextIndex;
    return { gameState, nextIndex, handComplete: false };
  }
}
