// バリアント固有ロジックの抽象化
// PLO / Stud系 の分岐を一箇所に集約し、TableInstance から variant 判定を排除する

import { GameState, GameVariant, Action, Player, Card, getVariantConfig } from '../../../shared/logic/types.js';
import { createInitialGameState, startNewHand, getValidActions, applyAction, wouldAdvanceStreet, determineWinner } from '../../../shared/logic/gameEngine.js';
import { createStudGameState, startStudHand, getStudValidActions, applyStudAction, wouldStudAdvanceStreet, determineStudWinner } from '../../../shared/logic/studEngine.js';
import { createDrawGameState, startDrawHand, getDrawValidActions, applyDrawAction, wouldDrawAdvanceStreet, determineDrawWinner } from '../../../shared/logic/drawEngine.js';
import { createLimitHoldemGameState, startLimitHoldemHand, getLimitHoldemValidActions, applyLimitHoldemAction, wouldLimitHoldemAdvanceStreet, determineLimitHoldemWinner } from '../../../shared/logic/limitHoldemEngine.js';
import { createOmahaHiLoGameState, startOmahaHiLoHand, getOmahaHiLoValidActions, applyOmahaHiLoAction, wouldOmahaHiLoAdvanceStreet, determineOmahaHiLoWinner } from '../../../shared/logic/omahaHiLoEngine.js';
import { createBombPotGameState, startBombPotHand, getBombPotValidActions, applyBombPotAction, wouldBombPotAdvanceStreet, determineBombPotWinner } from '../../../shared/logic/bombPotEngine.js';
import { evaluatePLOHand, evaluateHoldemHand, evaluate27LowHand, evaluateOmahaHiLoHand } from '../../../shared/logic/handEvaluator.js';
import { StudVariantRules } from '../../../shared/logic/studVariantRules.js';
import { StudHighRules } from '../../../shared/logic/rules/studHighRules.js';
import { RazzRules } from '../../../shared/logic/rules/razzRules.js';
import { StudHiLoRules } from '../../../shared/logic/rules/studHiLoRules.js';
import { SeatInfo } from '../types.js';
import { BroadcastService } from './BroadcastService.js';
import { TABLE_CONSTANTS } from '../constants.js';

export type ValidAction = { action: Action; minAmount: number; maxAmount: number };

/** variant から対応する StudVariantRules を取得 */
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
  createGameState(buyInChips: number, smallBlind: number, bigBlind: number, ante: number = 0): GameState {
    // omaha_hilo は family === 'omaha' だが PLO とは別エンジン
    if (this.variant === 'omaha_hilo') {
      return createOmahaHiLoGameState(buyInChips, smallBlind, bigBlind);
    }
    // plo_double_board_bomb は family === 'omaha' だが専用エンジン。
    // SB/BB は投稿せず全員アンテのみ。blind level の ante フィールドを直接使う。
    if (this.variant === 'plo_double_board_bomb') {
      const state = createBombPotGameState(buyInChips);
      state.smallBlind = smallBlind;
      state.bigBlind = bigBlind;
      state.ante = ante;
      return state;
    }
    switch (this.config.family) {
      case 'stud': {
        // Stud は SB を 1/4 にしたものを ante として使う既存ルール (blind level の ante は未使用)
        const studAnte = Math.ceil(smallBlind / 4);
        return createStudGameState(buyInChips, studAnte, smallBlind, this.variant);
      }
      case 'draw':
        return createDrawGameState(buyInChips, smallBlind, this.config.maxDraws);
      case 'holdem':
        return createLimitHoldemGameState(buyInChips, smallBlind, bigBlind);
      default: {
        // PLO / PLO5 はどちらも createInitialGameState を経由する。
        // 配布枚数は startNewHand 内で variant.holeCardCount から動的に決まるため、
        // ここで variant を正しく設定しておく必要がある（デフォルトは 'plo'）。
        const state = createInitialGameState(buyInChips);
        state.variant = this.variant;
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
    if (this.variant === 'omaha_hilo') return startOmahaHiLoHand(gameState);
    if (this.variant === 'plo_double_board_bomb') return startBombPotHand(gameState);
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
    if (this.variant === 'omaha_hilo') return getOmahaHiLoValidActions(gameState, seatIndex);
    if (this.variant === 'plo_double_board_bomb') return getBombPotValidActions(gameState, seatIndex);
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
   * bomb pot 時は boards を渡すと "B1: X / B2: Y" 形式で返す。
   */
  evaluateHandName(player: Player, communityCards: Card[], boards?: Card[][]): string {
    try {
      if (this.variant === 'omaha_hilo' || this.variant === 'plo_hilo') {
        if (communityCards.length === 5 && player.holeCards.length === 4) {
          const { high, low } = evaluateOmahaHiLoHand(player.holeCards, communityCards);
          return low ? `${high.name} / ${low.name}` : high.name;
        }
        return '';
      }
      if (this.variant === 'plo_double_board_bomb') {
        if (!boards || boards.length !== 2 || player.holeCards.length !== 4) return '';
        if (boards[0].length !== 5 || boards[1].length !== 5) return '';
        const h1 = evaluatePLOHand(player.holeCards, boards[0]).name;
        const h2 = evaluatePLOHand(player.holeCards, boards[1]).name;
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
    if (this.variant === 'omaha_hilo') return applyOmahaHiLoAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
    if (this.variant === 'plo_double_board_bomb') return applyBombPotAction(gameState, seatIndex, action, amount, rakePercent, rakeCapBB);
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
    if (this.variant === 'omaha_hilo') return wouldOmahaHiLoAdvanceStreet(gameState, seatIndex, action, amount);
    if (this.variant === 'plo_double_board_bomb') return wouldBombPotAdvanceStreet(gameState, seatIndex, action, amount);
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
    if (this.variant === 'omaha_hilo') return determineOmahaHiLoWinner(gameState, rakePercent, rakeCapBB);
    if (this.variant === 'plo_double_board_bomb') return determineBombPotWinner(gameState, rakePercent, rakeCapBB);
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
