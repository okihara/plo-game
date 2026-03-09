// バリアント固有ロジックの抽象化
// PLO / Stud系 の分岐を一箇所に集約し、TableInstance から variant 判定を排除する

import { GameState, GameVariant, Action, Player, Card, getVariantConfig } from '../../../shared/logic/types.js';
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

export class VariantAdapter {
  private readonly config;
  private readonly studRules?: StudVariantRules;

  constructor(private readonly variant: GameVariant) {
    this.config = getVariantConfig(variant);
    if (this.config.family === 'stud') {
      this.studRules = getStudRules(variant);
    }
  }

  /**
   * 初期ゲーム状態を作成
   */
  createGameState(buyInChips: number, smallBlind: number, bigBlind: number): GameState {
    switch (this.config.family) {
      case 'stud': {
        const ante = Math.ceil(smallBlind / 4);
        return createStudGameState(buyInChips, ante, smallBlind, this.variant);
      }
      case 'draw':
        return createDrawGameState(buyInChips, smallBlind, this.config.maxDraws);
      case 'holdem':
        return createLimitHoldemGameState(buyInChips, smallBlind, bigBlind);
      default: {
        const state = createInitialGameState(buyInChips);
        state.smallBlind = smallBlind;
        state.bigBlind = bigBlind;
        return state;
      }
    }
  }

  /**
   * ハンドを開始（ディーラーポジション進行・カード配布等）
   */
  startHand(gameState: GameState): GameState {
    switch (this.config.family) {
      case 'stud':
        return startStudHand(gameState, this.studRules!);
      case 'draw':
        return startDrawHand(gameState);
      case 'holdem':
        return startLimitHoldemHand(gameState);
      default:
        return startNewHand(gameState);
    }
  }

  /**
   * 有効なアクション一覧を取得
   */
  getValidActions(gameState: GameState, seatIndex: number): ValidAction[] {
    switch (this.config.family) {
      case 'stud':
        return getStudValidActions(gameState, seatIndex);
      case 'draw':
        return getDrawValidActions(gameState, seatIndex);
      case 'holdem':
        return getLimitHoldemValidActions(gameState, seatIndex);
      default:
        return getValidActions(gameState, seatIndex);
    }
  }

  /**
   * ショーダウン用のハンド名を評価
   */
  evaluateHandName(player: Player, communityCards: Card[]): string {
    try {
      switch (this.config.family) {
        case 'stud':
          return this.studRules!.describeHand(player.holeCards);
        case 'draw':
          if (player.holeCards.length === 5) {
            return evaluate27LowHand(player.holeCards).name;
          }
          return '';
        case 'holdem':
          if (communityCards.length === 5 && player.holeCards.length === 2) {
            return evaluateHoldemHand(player.holeCards, communityCards).name;
          }
          return '';
        default:
          if (communityCards.length === 5) {
            return evaluatePLOHand(player.holeCards, communityCards).name;
          }
          return '';
      }
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
    switch (this.config.family) {
      case 'stud':
        return applyStudAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB, this.studRules!);
      case 'draw':
        return applyDrawAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB, discardIndices);
      case 'holdem':
        return applyLimitHoldemAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
      default:
        return applyAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
    }
  }

  /**
   * アクション適用前にストリートが変わるかを判定
   */
  wouldAdvanceStreet(gameState: GameState, seatIndex: number, action: Action, amount: number, discardIndices?: number[]): boolean {
    switch (this.config.family) {
      case 'stud':
        return wouldStudAdvanceStreet(gameState, seatIndex, action, amount, this.studRules!);
      case 'draw':
        return wouldDrawAdvanceStreet(gameState, seatIndex, action, amount, discardIndices);
      case 'holdem':
        return wouldLimitHoldemAdvanceStreet(gameState, seatIndex, action, amount);
      default:
        return wouldAdvanceStreet(gameState, seatIndex, action, amount);
    }
  }

  /**
   * 勝者を決定
   */
  determineWinner(gameState: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
    switch (this.config.family) {
      case 'stud':
        return determineStudWinner(gameState, rakePercent, rakeCapBB, this.studRules!);
      case 'draw':
        return determineDrawWinner(gameState, rakePercent, rakeCapBB);
      case 'holdem':
        return determineLimitHoldemWinner(gameState, rakePercent, rakeCapBB);
      default:
        return determineWinner(gameState, rakePercent, rakeCapBB);
    }
  }

  /**
   * ストリート変更時に新しいカード情報をプレイヤー・スペクテーターに送信
   * Stud系/Draw系: 各ストリートで新しいカードが配られるため再送信が必要
   * PLO/Holdem: コミュニティカードは game:state で配信されるため何もしない
   */
  broadcastStreetChangeCards(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    broadcast: BroadcastService,
    broadcastSpectatorCards: () => void,
  ): void {
    if (this.config.usesCommunityCards) return;

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
