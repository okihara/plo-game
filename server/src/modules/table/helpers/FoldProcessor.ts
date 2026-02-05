// Fold処理の統一
// unseatPlayer, handleFastFold, requestNextActionで重複していた処理を統合

import { GameState } from '../../../shared/logic/types.js';
import { BroadcastService } from './BroadcastService.js';
import { FoldContext } from '../types.js';

export interface FoldResult {
  gameState: GameState;
  requiresAdvance: boolean;
}

export class FoldProcessor {
  constructor(private broadcast: BroadcastService) {}

  /**
   * プレイヤーをFoldさせる（共通処理）
   */
  processFold(
    gameState: GameState,
    context: FoldContext
  ): FoldResult {
    const player = gameState.players[context.seatIndex];

    if (!player || player.folded) {
      return { gameState, requiresAdvance: false };
    }

    player.folded = true;

    // Fold アクションをブロードキャスト
    this.broadcast.emitToRoom('game:action_taken', {
      playerId: context.playerId,
      action: 'fold',
      amount: 0,
    });

    return {
      gameState,
      requiresAdvance: context.wasCurrentPlayer,
    };
  }

  /**
   * 切断されたプレイヤーのFold処理（ブロードキャストあり）
   */
  processDisconnectedFold(
    gameState: GameState,
    seatIndex: number,
    playerId: string
  ): GameState {
    const player = gameState.players[seatIndex];

    if (!player || player.folded) {
      return gameState;
    }

    player.folded = true;

    this.broadcast.emitToRoom('game:action_taken', {
      playerId,
      action: 'fold',
      amount: 0,
    });

    return gameState;
  }

  /**
   * サイレントFold（ブロードキャストなし）
   * タイムアウト時の内部状態更新用
   */
  processSilentFold(
    gameState: GameState,
    seatIndex: number
  ): GameState {
    const player = gameState.players[seatIndex];

    if (player && !player.folded) {
      player.folded = true;
    }

    return gameState;
  }
}
