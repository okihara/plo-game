// バリアント固有ロジックの抽象化
// PLO / Stud の分岐を一箇所に集約し、TableInstance から variant 判定を排除する

import { GameState, GameVariant, Action, Player, Card } from '../../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getValidActions } from '../../../shared/logic/gameEngine.js';
import { createStudGameState, startStudHand, getStudValidActions } from '../../../shared/logic/studEngine.js';
import { evaluatePLOHand, evaluateStudHand } from '../../../shared/logic/handEvaluator.js';
import { SeatInfo } from '../types.js';
import { BroadcastService } from './BroadcastService.js';
import { TABLE_CONSTANTS } from '../constants.js';

export type ValidAction = { action: Action; minAmount: number; maxAmount: number };

export class VariantAdapter {
  constructor(private readonly variant: GameVariant) {}

  /**
   * 初期ゲーム状態を作成
   */
  createGameState(buyInChips: number, smallBlind: number, bigBlind: number): GameState {
    if (this.variant === 'stud') {
      const ante = Math.ceil(smallBlind / 2);
      return createStudGameState(buyInChips, ante, smallBlind);
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
    if (this.variant === 'stud') {
      return startStudHand(gameState);
    }
    return startNewHand(gameState);
  }

  /**
   * 有効なアクション一覧を取得
   */
  getValidActions(gameState: GameState, seatIndex: number): ValidAction[] {
    if (this.variant === 'stud') {
      return getStudValidActions(gameState, seatIndex);
    }
    return getValidActions(gameState, seatIndex);
  }

  /**
   * ショーダウン用のハンド名を評価
   */
  evaluateHandName(player: Player, communityCards: Card[]): string {
    try {
      if (this.variant === 'stud') {
        const allCards = [...player.holeCards, ...player.upCards];
        if (allCards.length >= 5) {
          return evaluateStudHand(allCards).name;
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
   * Stud: 裏カード + 表カード、PLO: ホールカードのみ
   */
  getShowdownCards(player: Player): Card[] {
    if (this.variant === 'stud') {
      return [...player.holeCards, ...player.upCards];
    }
    return player.holeCards;
  }

  /**
   * ストリート変更時に新しいカード情報をプレイヤー・スペクテーターに送信
   * Stud: 各ストリートで新しいカードが配られるため再送信が必要
   * PLO: コミュニティカードは game:state で配信されるため何もしない
   */
  broadcastStreetChangeCards(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    broadcast: BroadcastService,
    broadcastSpectatorCards: () => void,
  ): void {
    if (this.variant !== 'stud') return;

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
