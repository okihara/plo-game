// バリアント固有ロジックの抽象化
// PLO / Stud系 の分岐を一箇所に集約し、TableInstance から variant 判定を排除する

import { GameState, GameVariant, Action, Player, Card } from '../../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getValidActions, applyAction, wouldAdvanceStreet, determineWinner } from '../../../shared/logic/gameEngine.js';
import { createStudGameState, startStudHand, getStudValidActions, applyStudAction, wouldStudAdvanceStreet, determineStudWinner } from '../../../shared/logic/studEngine.js';
import { createDrawGameState, startDrawHand, getDrawValidActions, applyDrawAction, wouldDrawAdvanceStreet, determineDrawWinner } from '../../../shared/logic/drawEngine.js';
import { createLimitHoldemGameState, startLimitHoldemHand, getLimitHoldemValidActions, applyLimitHoldemAction, wouldLimitHoldemAdvanceStreet, determineLimitHoldemWinner } from '../../../shared/logic/limitHoldemEngine.js';
import { evaluatePLOHand, evaluateHoldemHand, evaluate27LowHand } from '../../../shared/logic/handEvaluator.js';
import { StudVariantRules } from '../../../shared/logic/studVariantRules.js';
import { StudHighRules } from '../../../shared/logic/rules/studHighRules.js';
import { RazzRules } from '../../../shared/logic/rules/razzRules.js';
import { SeatInfo } from '../types.js';
import { BroadcastService } from './BroadcastService.js';
import { TABLE_CONSTANTS } from '../constants.js';

export type ValidAction = { action: Action; minAmount: number; maxAmount: number };

/** variant から対応する StudVariantRules を取得 */
function getStudRules(variant: GameVariant): StudVariantRules {
  switch (variant) {
    case 'razz': return new RazzRules();
    case 'stud': return new StudHighRules();
    default: return new StudHighRules();
  }
}

/** Stud 系バリアントかどうか */
function isStudFamily(variant: GameVariant): boolean {
  return variant === 'stud' || variant === 'razz';
}

/** Draw 系バリアントかどうか */
function isDrawFamily(variant: GameVariant): boolean {
  return variant === 'limit_2-7_triple_draw' || variant === 'no_limit_2-7_single_draw';
}

/** Limit Hold'em かどうか */
function isLimitHoldem(variant: GameVariant): boolean {
  return variant === 'limit_holdem';
}

/** variant から maxDraws を取得 */
function getMaxDraws(variant: GameVariant): number {
  return variant === 'no_limit_2-7_single_draw' ? 1 : 3;
}

export class VariantAdapter {
  private readonly studRules?: StudVariantRules;
  private readonly maxDraws?: number;

  constructor(private readonly variant: GameVariant) {
    if (isStudFamily(variant)) {
      this.studRules = getStudRules(variant);
    }
    if (isDrawFamily(variant)) {
      this.maxDraws = getMaxDraws(variant);
    }
  }

  /**
   * 初期ゲーム状態を作成
   */
  createGameState(buyInChips: number, smallBlind: number, bigBlind: number): GameState {
    if (isStudFamily(this.variant)) {
      const ante = Math.ceil(smallBlind / 4);
      return createStudGameState(buyInChips, ante, smallBlind, this.variant);
    }
    if (isDrawFamily(this.variant)) {
      return createDrawGameState(buyInChips, smallBlind, this.maxDraws!);
    }
    if (isLimitHoldem(this.variant)) {
      return createLimitHoldemGameState(buyInChips, smallBlind, bigBlind);
    }
    const state = createInitialGameState(buyInChips);
    state.smallBlind = smallBlind;
    state.bigBlind = bigBlind;
    return state;
  }

  /**
   * ハンドを開始（ディーラーポジション進行・カード配布等）
   */
  startHand(gameState: GameState): GameState {
    if (isStudFamily(this.variant)) {
      return startStudHand(gameState, this.studRules!);
    }
    if (isDrawFamily(this.variant)) {
      return startDrawHand(gameState);
    }
    if (isLimitHoldem(this.variant)) {
      return startLimitHoldemHand(gameState);
    }
    return startNewHand(gameState);
  }

  /**
   * 有効なアクション一覧を取得
   */
  getValidActions(gameState: GameState, seatIndex: number): ValidAction[] {
    if (isStudFamily(this.variant)) {
      return getStudValidActions(gameState, seatIndex);
    }
    if (isDrawFamily(this.variant)) {
      return getDrawValidActions(gameState, seatIndex);
    }
    if (isLimitHoldem(this.variant)) {
      return getLimitHoldemValidActions(gameState, seatIndex);
    }
    return getValidActions(gameState, seatIndex);
  }

  /**
   * ショーダウン用のハンド名を評価
   */
  evaluateHandName(player: Player, communityCards: Card[]): string {
    try {
      if (isStudFamily(this.variant)) {
        return this.studRules!.describeHand(player.holeCards);
      }
      if (isDrawFamily(this.variant)) {
        if (player.holeCards.length === 5) {
          return evaluate27LowHand(player.holeCards).name;
        }
        return '';
      }
      if (isLimitHoldem(this.variant)) {
        if (communityCards.length === 5 && player.holeCards.length === 2) {
          return evaluateHoldemHand(player.holeCards, communityCards).name;
        }
        return '';
      }
      if (communityCards.length === 5) {
        return evaluatePLOHand(player.holeCards, communityCards).name;
      }
      return '';
    } catch (e) {
      console.warn('Showdown hand evaluation failed for seat', player.id, e);
      return '';
    }
  }

  /**
   * ショーダウンで公開するカードを取得
   */
  getShowdownCards(player: Player): Card[] {
    return player.holeCards;
  }

  /**
   * アクションを適用して新しいGameStateを返す
   */
  applyAction(gameState: GameState, seatIndex: number, action: Action, amount: number, rakePercent: number, rakeCapBB: number, discardIndices?: number[]): GameState {
    if (isStudFamily(this.variant)) {
      return applyStudAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB, this.studRules!);
    }
    if (isDrawFamily(this.variant)) {
      return applyDrawAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB, discardIndices);
    }
    if (isLimitHoldem(this.variant)) {
      return applyLimitHoldemAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
    }
    return applyAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
  }

  /**
   * アクション適用前にストリートが変わるかを判定
   */
  wouldAdvanceStreet(gameState: GameState, seatIndex: number, action: Action, amount: number, discardIndices?: number[]): boolean {
    if (isStudFamily(this.variant)) {
      return wouldStudAdvanceStreet(gameState, seatIndex, action, amount, this.studRules!);
    }
    if (isDrawFamily(this.variant)) {
      return wouldDrawAdvanceStreet(gameState, seatIndex, action, amount, discardIndices);
    }
    if (isLimitHoldem(this.variant)) {
      return wouldLimitHoldemAdvanceStreet(gameState, seatIndex, action, amount);
    }
    return wouldAdvanceStreet(gameState, seatIndex, action, amount);
  }

  /**
   * 勝者を決定
   */
  determineWinner(gameState: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
    if (isStudFamily(this.variant)) {
      return determineStudWinner(gameState, rakePercent, rakeCapBB, this.studRules!);
    }
    if (isDrawFamily(this.variant)) {
      return determineDrawWinner(gameState, rakePercent, rakeCapBB);
    }
    if (isLimitHoldem(this.variant)) {
      return determineLimitHoldemWinner(gameState, rakePercent, rakeCapBB);
    }
    return determineWinner(gameState, rakePercent, rakeCapBB);
  }

  /**
   * ストリート変更時に新しいカード情報をプレイヤー・スペクテーターに送信
   * Stud系: 各ストリートで新しいカードが配られるため再送信が必要
   * PLO: コミュニティカードは game:state で配信されるため何もしない
   */
  broadcastStreetChangeCards(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    broadcast: BroadcastService,
    broadcastSpectatorCards: () => void,
  ): void {
    if (!isStudFamily(this.variant) && !isDrawFamily(this.variant)) return;

    // Draw: ドローフェーズ後に新しいカードが配られるため再送信
    if (isDrawFamily(this.variant)) {
      for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
        const seat = seats[i];
        if (seat?.socket && gameState.players[i].holeCards.length > 0) {
          broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', {
            cards: gameState.players[i].holeCards,
          });
        }
      }
      broadcastSpectatorCards();
      return;
    }

    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      if (seat?.socket && gameState.players[i].holeCards.length > 0) {
        broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', {
          cards: gameState.players[i].holeCards,
        });
      }
    }
    broadcastSpectatorCards();
  }
}
