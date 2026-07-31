// 新エンジン v1 の AIVariantStrategy 実装。
// - プリフロップ: 旧エンジン（Phase 1 で 3bet/4bet 防御をパッチ済み）を再利用
// - ポストフロップ: EV ベース意思決定 (engine/evDecision.ts) に全面置換
// パーソナリティは攻撃性の薄い係数としてのみ効かせる（原則 6: 個性は最終段の薄い層）。

import { GameState, Action } from '../types.js';
import { AIVariantStrategy, AIContext, BotPersonality } from '../ai/types.js';
import { getPreflopDecision } from '../ai/preflopStrategy.js';
import { getPositionBonus } from '../cpuAI.js';
import { decidePostflop } from './engine/evDecision.js';

export class PLOStrategy2 implements AIVariantStrategy {
  getAction(
    state: GameState,
    playerIndex: number,
    personality: BotPersonality,
    _positionBonus: number,
    context: AIContext
  ): { action: Action; amount: number } {
    const positionBonus = getPositionBonus(state.players[playerIndex].position);

    if (state.currentStreet === 'preflop') {
      return getPreflopDecision(state, playerIndex, personality, positionBonus, context.opponentModel);
    }

    // aggression 0.75 を基準に ±数% だけベット系 EV を補正
    const aggressionMod = (personality.aggression - 0.75) * 0.08;
    return decidePostflop(state, playerIndex, aggressionMod);
  }
}
