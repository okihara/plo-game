import { GameState, Action, Card } from '../types.js';
import { getDrawValidActions } from '../drawEngine.js';
import { evaluate27LowHand } from '../handEvaluator.js';
import { getRankValue } from '../deck.js';
import { AIVariantStrategy, AIContext, BotPersonality } from './types.js';
import { isDrawStreet } from '../drawEngine.js';

/**
 * 2-7 Draw AI 戦略（ランダムベース）
 *
 * ドローフェーズ: ペア・高カードを優先的に捨てる（基本戦略）
 * ベッティングフェーズ: ハンド強度ベースのシンプルな判定
 */
export class DrawStrategy implements AIVariantStrategy {
  getAction(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    _positionBonus: number,
    _context: AIContext,
  ): { action: Action; amount: number; discardIndices?: number[] } {
    const player = state.players[playerIndex];
    const validActions = getDrawValidActions(state, playerIndex);

    if (validActions.length === 0) {
      return { action: 'fold', amount: 0 };
    }

    // ドローフェーズ: カードを選んで交換
    if (isDrawStreet(state.currentStreet)) {
      const discardIndices = this.selectDiscards(player.holeCards, personality);
      return { action: 'draw' as Action, amount: 0, discardIndices };
    }

    // ベッティングフェーズ
    const strength = this.evaluateStrength(player.holeCards);
    const toCall = state.currentBet - player.currentBet;
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;

    return this.decide(validActions, strength, toCall, potOdds, state, personality);
  }

  /**
   * ドローフェーズ: 捨てるカードのインデックスを決定
   *
   * 基本戦略:
   * - ペアがあれば片方を捨てる
   * - 高カード (T以上) を捨てる
   * - ただし7以下のカードは残す
   * - パーソナリティの aggression で stand pat の閾値を調整
   */
  private selectDiscards(cards: Card[], personality: BotPersonality): number[] {
    if (cards.length !== 5) return [];

    const values = cards.map(c => getRankValue(c.rank));
    const discardIndices: number[] = [];

    // ペア検出: 同じランクのカードがあれば片方を捨てる
    const seen = new Map<number, number[]>();
    for (let i = 0; i < 5; i++) {
      const v = values[i];
      if (!seen.has(v)) seen.set(v, []);
      seen.get(v)!.push(i);
    }

    const pairIndices = new Set<number>();
    for (const [, indices] of seen) {
      if (indices.length >= 2) {
        // ペア以上: 1枚だけ残す
        for (let i = 1; i < indices.length; i++) {
          pairIndices.add(indices[i]);
        }
      }
    }

    // 捨てる候補: ペアの片方 + 高カード
    for (let i = 0; i < 5; i++) {
      if (pairIndices.has(i)) {
        discardIndices.push(i);
        continue;
      }
      // 高カード (T=10 以上、ただし 2-7 なのでAは14で最悪)
      if (values[i] >= 10) {
        discardIndices.push(i);
      }
    }

    // 8, 9 のカードは微妙: アグレッシブなら捨てる、パッシブなら残す
    if (discardIndices.length === 0) {
      for (let i = 0; i < 5; i++) {
        if (values[i] === 9 && Math.random() < personality.aggression * 0.5) {
          discardIndices.push(i);
        } else if (values[i] === 8 && Math.random() < personality.aggression * 0.2) {
          discardIndices.push(i);
        }
      }
    }

    // 良いハンド（全て7以下でペアなし）ならスタンドパット
    // ただしランダムにスノー（ブラフスタンドパット）もする
    if (discardIndices.length === 0 && Math.random() < 0.05) {
      // 5% の確率でわざと1枚交換（バランス）
      const worstIdx = values.indexOf(Math.max(...values));
      if (values[worstIdx] >= 6) {
        discardIndices.push(worstIdx);
      }
    }

    // 最大5枚まで（実質的には3枚程度が多い）
    return discardIndices.slice(0, 5);
  }

  /**
   * ハンド強度評価 (0-1)
   * 2-7 ローボール: rank=1(ノーペア)が最強
   */
  private evaluateStrength(cards: Card[]): number {
    if (cards.length !== 5) return 0.3;

    try {
      const handRank = evaluate27LowHand(cards);

      // rank 1 (ノーペア) = 最強 → strength 高い
      // rank 9 (SF) = 最弱 → strength 低い
      let strength = 1.0 - (handRank.rank - 1) / 8;

      // ノーペアの場合: highCards[0] が低いほど強い
      if (handRank.rank === 1 && handRank.highCards.length > 0) {
        // 7-high → +0.2, 8-high → +0.1, K-high → -0.1
        strength += (8 - handRank.highCards[0]) / 15;
      }

      return Math.min(1, Math.max(0, strength));
    } catch {
      return 0.3;
    }
  }

  private decide(
    validActions: { action: Action; minAmount: number; maxAmount: number }[],
    strength: number,
    toCall: number,
    potOdds: number,
    state: GameState,
    personality: BotPersonality,
  ): { action: Action; amount: number } {
    const random = Math.random();

    // 閾値: パーソナリティで調整
    const playThreshold = Math.max(0.15, 0.50 - personality.vpip * 0.7);
    const raiseThreshold = playThreshold + 0.25;

    // 強いハンド: レイズ/ベット
    if (strength > raiseThreshold) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction && random < personality.aggression) {
        return { action: raiseAction.action, amount: raiseAction.minAmount };
      }
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
    }

    // ミディアム: コール or チェック
    if (strength > playThreshold) {
      if (toCall > 0 && potOdds < strength * 0.7) {
        const callAction = validActions.find(a => a.action === 'call');
        if (callAction) return { action: 'call', amount: callAction.minAmount };
      }
      const checkAction = validActions.find(a => a.action === 'check');
      if (checkAction) return { action: 'check', amount: 0 };
      if (toCall > 0) return { action: 'fold', amount: 0 };
    }

    // 弱い: チェック or フォールド
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // ブラフ
    if (random < personality.bluffFreq * 0.5) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) return { action: raiseAction.action, amount: raiseAction.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }
}
