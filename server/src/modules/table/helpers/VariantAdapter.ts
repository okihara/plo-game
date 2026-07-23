// バリアント固有ロジックの抽象化
// エンジンの実体は shared/logic/engine/ の共通コア + バリアント記述子。
// このクラスはテーブル層と記述子の橋渡し（+ ショーダウン表示などのUI寄り処理）を担う。

import { GameState, GameVariant, Action, Player, Card, getVariantConfig } from '../../../shared/logic/types.js';
import {
  startHandCore,
  getValidActionsCore,
  applyActionCore,
  wouldAdvanceStreetCore,
  determineWinnerCore,
} from '../../../shared/logic/engine/core.js';
import { getEngineDescriptor } from '../../../shared/logic/engine/registry.js';
import { VariantDescriptor } from '../../../shared/logic/engine/descriptor.js';
import { evaluatePLOHand, evaluateHoldemHand, evaluate27LowHand, evaluateOmahaHiLoHand, formatHandName } from '../../../shared/logic/handEvaluator.js';
import { StudVariantRules } from '../../../shared/logic/studVariantRules.js';
import { StudHighRules } from '../../../shared/logic/rules/studHighRules.js';
import { RazzRules } from '../../../shared/logic/rules/razzRules.js';
import { StudHiLoRules } from '../../../shared/logic/rules/studHiLoRules.js';
import { SeatInfo } from '../types.js';
import { BroadcastService } from './BroadcastService.js';
import { TABLE_CONSTANTS } from '../constants.js';

export type ValidAction = { action: Action; minAmount: number; maxAmount: number };

/** variant から対応する StudVariantRules を取得（ショーダウン表示用） */
function getStudRules(variant: GameVariant): StudVariantRules {
  switch (variant) {
    case 'razz': return new RazzRules();
    case 'stud_hilo': return new StudHiLoRules();
    case 'stud': return new StudHighRules();
    default: return new StudHighRules();
  }
}

export class VariantAdapter {
  private readonly config;
  private readonly engine: VariantDescriptor;
  private readonly studRules?: StudVariantRules;

  constructor(private readonly variant: GameVariant) {
    this.config = getVariantConfig(variant);
    this.engine = getEngineDescriptor(variant);
    if (this.config.family === 'stud') {
      this.studRules = getStudRules(variant);
    }
  }

  /**
   * 初期ゲーム状態を作成
   */
  createGameState(buyInChips: number, smallBlind: number, bigBlind: number, ante: number = 0): GameState {
    return this.engine.createTableState(this.variant, buyInChips, smallBlind, bigBlind, ante);
  }

  /**
   * ハンドを開始（ディーラーポジション進行・カード配布等）
   */
  startHand(gameState: GameState): GameState {
    return startHandCore(gameState, this.engine);
  }

  /**
   * 有効なアクション一覧を取得
   */
  getValidActions(gameState: GameState, seatIndex: number): ValidAction[] {
    return getValidActionsCore(gameState, seatIndex, this.engine);
  }

  /**
   * ショーダウン用のハンド名を評価
   * bomb pot 時は boards を渡すと "B1: X / B2: Y" 形式で返す。
   */
  evaluateHandName(player: Player, communityCards: Card[], boards?: Card[][]): string {
    try {
      if (this.variant === 'omaha_hilo' || this.variant === 'plo_hilo' || this.variant === 'big_o') {
        const expectedHoleCount = this.config.holeCardCount;
        if (communityCards.length === 5 && player.holeCards.length === expectedHoleCount) {
          const { high, low } = evaluateOmahaHiLoHand(player.holeCards, communityCards);
          return low ? `${formatHandName(high)} / ${low.name}` : formatHandName(high);
        }
        return '';
      }
      if (this.variant === 'plo_double_board_bomb') {
        if (!boards || boards.length !== 2 || player.holeCards.length !== 4) return '';
        if (boards[0].length !== 5 || boards[1].length !== 5) return '';
        const h1 = formatHandName(evaluatePLOHand(player.holeCards, boards[0]));
        const h2 = formatHandName(evaluatePLOHand(player.holeCards, boards[1]));
        return `B1: ${h1} / B2: ${h2}`;
      }
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
            return formatHandName(evaluateHoldemHand(player.holeCards, communityCards));
          }
          return '';
        default:
          if (communityCards.length === 5) {
            return formatHandName(evaluatePLOHand(player.holeCards, communityCards));
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
    return applyActionCore(gameState, seatIndex, action, amount, this.engine, rakePercent, rakeCapBB, discardIndices);
  }

  /**
   * アクション適用前にストリートが変わるかを判定
   */
  wouldAdvanceStreet(gameState: GameState, seatIndex: number, action: Action, amount: number, discardIndices?: number[]): boolean {
    return wouldAdvanceStreetCore(gameState, seatIndex, action, amount, this.engine, discardIndices);
  }

  /**
   * 勝者を決定
   */
  determineWinner(gameState: GameState, rakePercent: number = 0, rakeCapBB: number = 0): GameState {
    return determineWinnerCore(gameState, this.engine, rakePercent, rakeCapBB);
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
    emitSpectatorHoleCards: (seatIndex: number) => void,
  ): void {
    if (this.config.usesCommunityCards) return;

    for (let i = 0; i < TABLE_CONSTANTS.MAX_PLAYERS; i++) {
      const seat = seats[i];
      const holeCards = gameState.players[i].holeCards;
      if (holeCards.length === 0) continue;
      if (!seat || seat.waitingForNextHand) continue;

      if (seat.socket) {
        broadcast.emitToSocket(seat.socket, seat.odId, 'game:hole_cards', {
          cards: holeCards,
          seatIndex: i,
        });
      }
      emitSpectatorHoleCards(i);
    }
  }
}
