import { GameState, Action } from '../types.js';
import { getStudValidActions } from '../studEngine.js';
import { evaluateRazzHand } from '../handEvaluator.js';
import { AIVariantStrategy, AIContext, BotPersonality } from './types.js';

/**
 * Razz AI 戦略
 *
 * ローハンド強度ベースの判定:
 * - evaluateRazzHand で A-5 ロー評価
 * - 低いハンド = 強い → strength が高い
 * - パーソナリティで閾値調整
 */
export class RazzStrategy implements AIVariantStrategy {
  getAction(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    _positionBonus: number,
    _context: AIContext,
  ): { action: Action; amount: number } {
    const player = state.players[playerIndex];
    const validActions = getStudValidActions(state, playerIndex);

    if (validActions.length === 0) {
      return { action: 'fold', amount: 0 };
    }

    const strength = player.holeCards.length >= 5
      ? this.evaluateStrength(player.holeCards)
      : this.evaluatePartialHand(player.holeCards);

    const toCall = state.currentBet - player.currentBet;
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;

    return this.decide(validActions, strength, toCall, potOdds, state, personality);
  }

  /** 5枚以上: evaluateRazzHand でロー評価 → strength に変換 */
  private evaluateStrength(allCards: { rank: string; suit: string }[]): number {
    try {
      const handRank = evaluateRazzHand(allCards as any);
      // Razz: rank=1(ノーペア)が最強、rank=6(フォーカード)が最弱
      // rank 1 → strength ~0.8-1.0, rank 6 → strength ~0.0
      let strength = 1.0 - (handRank.rank - 1) / 5;

      // ノーペアの場合: highCards[0] が低いほど強い (1=A が最強)
      if (handRank.rank === 1 && handRank.highCards.length > 0) {
        // highCards[0] は最高カード値（降順）: 5(wheel)〜13(K)
        // 5 → +0.2, 8 → +0.05, 13 → -0.15
        strength += (8 - handRank.highCards[0]) / 20;
      }

      return Math.min(1, Math.max(0, strength));
    } catch {
      return 0.3;
    }
  }

  /** 5枚未満（third/fourth street）: 低カードが多い=強い、ペア=弱い */
  private evaluatePartialHand(allCards: { rank: string; suit: string }[]): number {
    const rankValues = allCards.map(c => this.getRazzRankValue(c.rank));

    // 低カードの平均値が低いほど強い（Ace=1 が最低）
    const avgValue = rankValues.reduce((a, b) => a + b, 0) / rankValues.length;
    // avgValue 1(全Ace) → strength 0.8, avgValue 13(全K) → strength 0.0
    let strength = Math.max(0, (13 - avgValue) / 12 * 0.8);

    // ペア検出（Razz ではペアは悪い）
    const counts = new Map<number, number>();
    for (const v of rankValues) counts.set(v, (counts.get(v) ?? 0) + 1);
    const maxCount = Math.max(...counts.values(), 0);
    if (maxCount >= 3) strength -= 0.3;       // トリップス: 大幅ペナルティ
    else if (maxCount >= 2) strength -= 0.15; // ペア: ペナルティ

    // 低カード(A-5)の枚数ボーナス
    const lowCardCount = rankValues.filter(v => v <= 5).length;
    strength += lowCardCount * 0.05;

    return Math.min(1, Math.max(0, strength));
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

    const playThreshold = Math.max(0.15, 0.55 - personality.vpip * 0.8);
    const raiseThreshold = playThreshold + 0.2;

    // 強いロー: レイズ/ベット
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

    // 弱いハンド: チェック or フォールド
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // ブリングイン対応
    if (toCall > 0 && toCall <= state.bigBlind && random < personality.vpip) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    // ブラフ
    if (random < personality.bluffFreq * 0.5) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) return { action: raiseAction.action, amount: raiseAction.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }

  private getRazzRankValue(rank: string): number {
    const map: Record<string, number> = {
      'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
      '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13,
    };
    return map[rank] ?? 0;
  }
}
