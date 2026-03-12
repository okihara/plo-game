import { GameState, Action } from '../types.js';
import { AIVariantStrategy, AIContext, BotPersonality, ExtendedHandEval } from './types.js';
import { deriveStreetHistory, getPositionBonus } from '../cpuAI.js';
import { analyzeBoard } from './boardAnalysis.js';
import { getPostflopDecision } from './postflopStrategy.js';
import { getValidActions } from '../gameEngine.js';
import { getRankValue } from '../deck.js';
import { evaluateCurrentHoldemHand } from '../handEvaluator.js';
import { Card } from '../types.js';

/**
 * Limit Hold'em 用 AI ストラテジー。
 * ホールカード2枚に対応したハンド評価を使用。
 */
export class LimitHoldemStrategy implements AIVariantStrategy {
  getAction(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    _positionBonus: number,
    context: AIContext,
  ): { action: Action; amount: number } {
    const player = state.players[playerIndex];
    const positionBonus = getPositionBonus(player.position);
    const handActions = context.handActions ?? state.handHistory;
    const streetHistory = deriveStreetHistory(state, handActions, playerIndex);

    if (state.currentStreet === 'preflop') {
      return this.getPreflopDecision(state, playerIndex, personality, positionBonus);
    }

    const activePlayers = state.players.filter(p => !p.isSittingOut && !p.folded).length;
    const numOpponents = activePlayers - 1;
    const boardTexture = analyzeBoard(state.communityCards);
    const handEval = this.evaluateHoldemHand(player.holeCards, state.communityCards);

    return getPostflopDecision(
      state, playerIndex, handEval, boardTexture, streetHistory,
      personality, positionBonus, context.opponentModel
    );
  }

  /**
   * Hold'em 用プリフロップ判定（2枚ベース）
   */
  private getPreflopDecision(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    positionBonus: number,
  ): { action: Action; amount: number } {
    const player = state.players[playerIndex];
    const validActions = getValidActions(state, playerIndex);
    const handStrength = this.evaluatePreflopStrength(player.holeCards);
    const effectiveStrength = Math.min(1, handStrength + positionBonus);
    const toCall = state.currentBet - player.currentBet;
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;
    const random = Math.random();
    const facingRaise = state.currentBet > state.bigBlind;

    // VPIP閾値
    const vpipThreshold = Math.max(0.10, 0.70 - personality.vpip * 1.3);

    if (effectiveStrength > 0.80) {
      // プレミアムハンド: レイズ
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) {
        const amount = Math.min(raiseAction.maxAmount, Math.max(raiseAction.minAmount, raiseAction.minAmount));
        return { action: raiseAction.action, amount };
      }
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    if (effectiveStrength > vpipThreshold + 0.15) {
      // 強いハンド: レイズまたはコール
      if (!facingRaise && random > 0.4) {
        const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
        if (raiseAction) {
          return { action: raiseAction.action, amount: raiseAction.minAmount };
        }
      }
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction && potOdds < effectiveStrength * 0.8) return { action: 'call', amount: callAction.minAmount };
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
    }

    if (effectiveStrength > vpipThreshold) {
      // マージナルハンド: コール可能
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      if (potOdds < 0.2 && toCall <= state.bigBlind * 2) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
    }

    // 弱いハンド
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };
    return { action: 'fold', amount: 0 };
  }

  /**
   * Hold'em 2枚のプリフロップ強度 (0-1)
   */
  private evaluatePreflopStrength(holeCards: Card[]): number {
    if (holeCards.length < 2) return 0.3;

    const v1 = getRankValue(holeCards[0].rank);
    const v2 = getRankValue(holeCards[1].rank);
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);
    const isPair = v1 === v2;
    const isSuited = holeCards[0].suit === holeCards[1].suit;
    const gap = high - low;

    let strength = 0;

    if (isPair) {
      // ペア: AA=1.0, KK=0.95, ..., 22=0.45
      strength = 0.40 + (high / 14) * 0.60;
    } else {
      // ハイカード基準
      strength = (high / 14) * 0.35 + (low / 14) * 0.15;
      // スーテッドボーナス
      if (isSuited) strength += 0.08;
      // コネクターボーナス
      if (gap === 1) strength += 0.06;
      else if (gap === 2) strength += 0.03;
      // ギャップペナルティ
      if (gap >= 5) strength -= 0.05;
    }

    return Math.min(1, Math.max(0, strength));
  }

  /**
   * Hold'em 用ポストフロップハンド評価 → ExtendedHandEval に変換
   */
  private evaluateHoldemHand(holeCards: Card[], communityCards: Card[]): ExtendedHandEval {
    if (communityCards.length < 3 || holeCards.length < 2) {
      return this.makeDefaultEval();
    }

    const madeHand = evaluateCurrentHoldemHand(holeCards, communityCards);
    if (!madeHand) {
      return this.makeDefaultEval();
    }

    let strength = madeHand.rank / 9;
    if (madeHand.highCards.length > 0) {
      strength += (madeHand.highCards[0] - 8) / 60;
    }
    strength = Math.min(1, strength);

    // フラッシュドロー判定
    const allCards = [...holeCards, ...communityCards];
    const suitCounts: Record<string, number> = {};
    for (const c of allCards) suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
    const hasFlushDraw = communityCards.length < 5 && Object.values(suitCounts).some(n => n === 4);

    // ストレートドロー判定（簡易）
    const values = [...new Set(allCards.map(c => getRankValue(c.rank)))].sort((a, b) => a - b);
    let hasStraightDraw = false;
    for (let i = 0; i <= values.length - 4; i++) {
      if (values[i + 3] - values[i] <= 4) {
        hasStraightDraw = true;
        break;
      }
    }

    let drawStrength = 0;
    if (hasFlushDraw) drawStrength += 0.3;
    if (hasStraightDraw) drawStrength += 0.2;
    if (communityCards.length < 5) {
      strength += drawStrength * 0.3;
      strength = Math.min(1, strength);
    }

    const isNuts = madeHand.rank >= 8;
    const isNearNuts = !isNuts && madeHand.rank >= 6;

    return {
      strength,
      madeHandRank: madeHand.rank,
      hasFlushDraw,
      hasStraightDraw,
      hasWrapDraw: false,
      drawStrength: Math.min(1, drawStrength),
      isNuts,
      isNearNuts,
      estimatedEquity: strength,
      blockerScore: 0,
      vulnerabilityToDraws: communityCards.length < 5 && madeHand.rank <= 2 ? 0.3 : 0,
    };
  }

  private makeDefaultEval(): ExtendedHandEval {
    return {
      strength: 0,
      madeHandRank: 0,
      hasFlushDraw: false,
      hasStraightDraw: false,
      hasWrapDraw: false,
      drawStrength: 0,
      isNuts: false,
      isNearNuts: false,
      estimatedEquity: 0,
      blockerScore: 0,
      vulnerabilityToDraws: 0,
    };
  }
}
