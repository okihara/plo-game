import { GameState, Action } from '../types.js';
import { getStudValidActions } from '../studEngine.js';
import { evaluateStudHand } from '../handEvaluator.js';
import { AIVariantStrategy, AIContext, BotPersonality } from './types.js';

/**
 * 7-Card Stud AI 戦略（簡易版）
 *
 * ハンド強度ベースの判定:
 * - 表カード + 裏カード全体を evaluateStudHand で評価
 * - ハンドランク + パーソナリティのアグレッション/VPIP で判定
 * - 将来的には相手のアップカード分析やドロー判定を追加可能
 */
export class StudStrategy implements AIVariantStrategy {
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

    // 全カードを結合してハンド評価
    const allCards = [...player.holeCards, ...player.upCards];
    const strength = allCards.length >= 5
      ? this.evaluateStrength(allCards)
      : this.evaluatePartialHand(allCards);

    const toCall = state.currentBet - player.currentBet;
    const potOdds = toCall > 0 ? toCall / (state.pot + toCall) : 0;

    return this.decide(validActions, strength, toCall, potOdds, state, personality);
  }

  /** 5枚以上ある場合: evaluateStudHand で正確な評価 */
  private evaluateStrength(allCards: { rank: string; suit: string }[]): number {
    try {
      const handRank = evaluateStudHand(allCards as any);
      // rank 0-9 を 0-1 にマッピング + highCards で微調整
      let strength = handRank.rank / 9;
      if (handRank.highCards.length > 0) {
        strength += (handRank.highCards[0] - 8) / 60;
      }
      return Math.min(1, Math.max(0, strength));
    } catch {
      return 0.3; // 評価エラー時はミディアム扱い
    }
  }

  /** 5枚未満（third/fourth street）: 簡易的にカードの高さ + ペア判定 */
  private evaluatePartialHand(allCards: { rank: string; suit: string }[]): number {
    const rankValues = allCards.map(c => this.getRankValue(c.rank));
    const avgValue = rankValues.reduce((a, b) => a + b, 0) / rankValues.length;

    // ペア検出
    const counts = new Map<number, number>();
    for (const v of rankValues) counts.set(v, (counts.get(v) ?? 0) + 1);
    const maxCount = Math.max(...counts.values(), 0);

    let strength = (avgValue - 2) / 12 * 0.4; // 高カードボーナス (0-0.4)
    if (maxCount >= 3) strength += 0.45;       // トリップス
    else if (maxCount >= 2) {
      const pairValue = [...counts.entries()].find(([_, c]) => c >= 2)?.[0] ?? 0;
      strength += 0.2 + (pairValue / 14) * 0.15; // ペア (0.2-0.35)
    }

    // 同スート3枚以上: フラッシュドロー補正
    const suitCounts = new Map<string, number>();
    for (const c of allCards) suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    if (Math.max(...suitCounts.values(), 0) >= 3) strength += 0.1;

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

    // 閾値をパーソナリティで調整
    const playThreshold = Math.max(0.15, 0.55 - personality.vpip * 0.8);
    const raiseThreshold = playThreshold + 0.2;

    // 強いハンド: レイズ/ベット
    if (strength > raiseThreshold) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction && random < personality.aggression) {
        // Stud はリミットなので常に固定額
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
      // コールが見合わない場合フォールド
      if (toCall > 0) return { action: 'fold', amount: 0 };
    }

    // 弱いハンド: チェック or フォールド
    const checkAction = validActions.find(a => a.action === 'check');
    if (checkAction) return { action: 'check', amount: 0 };

    // ブリングイン対応: コールが非常に安い場合は参加
    if (toCall > 0 && toCall <= state.bigBlind && random < personality.vpip) {
      const callAction = validActions.find(a => a.action === 'call');
      if (callAction) return { action: 'call', amount: callAction.minAmount };
    }

    // ブラフ: 低確率でレイズ
    if (random < personality.bluffFreq * 0.5) {
      const raiseAction = validActions.find(a => a.action === 'raise' || a.action === 'bet');
      if (raiseAction) return { action: raiseAction.action, amount: raiseAction.minAmount };
    }

    return { action: 'fold', amount: 0 };
  }

  private getRankValue(rank: string): number {
    const map: Record<string, number> = {
      '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8,
      '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14,
    };
    return map[rank] ?? 0;
  }
}
