// 卓内 HUD: この卓で遊んだハンドだけからプレイヤーごとの簡易スタッツを集計する（メモリのみ、卓と寿命を共にする）

import type { PlayerHudStats } from '@plo/shared';
import { GameState } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { computeHandIncrements } from '../../stats/handIncrements.js';

interface HudCounts {
  hands: number;
  detailedHands: number;
  vpipCount: number;
  pfrCount: number;
  threeBetCount: number;
  threeBetOpportunity: number;
}

function percent(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 100) : 0;
}

export class TableHudTracker {
  /** 席移動・離席→再着席しても同じ卓なら引き継ぐため odId で持つ */
  private readonly counts = new Map<string, HudCounts>();

  recordHand(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    startChips: Map<number, number>,
  ): void {
    for (const { odId, inc } of computeHandIncrements(gameState, seats, startChips)) {
      const c = this.counts.get(odId) ?? {
        hands: 0, detailedHands: 0, vpipCount: 0, pfrCount: 0, threeBetCount: 0, threeBetOpportunity: 0,
      };
      c.hands += inc.handsPlayed;
      c.detailedHands += inc.detailedHands;
      c.vpipCount += inc.vpipCount;
      c.pfrCount += inc.pfrCount;
      c.threeBetCount += inc.threeBetCount;
      c.threeBetOpportunity += inc.threeBetOpportunity;
      this.counts.set(odId, c);
    }
  }

  get(odId: string): PlayerHudStats | undefined {
    const c = this.counts.get(odId);
    if (!c) return undefined;
    return {
      hands: c.hands,
      vpip: percent(c.vpipCount, c.detailedHands),
      pfr: percent(c.pfrCount, c.detailedHands),
      threeBet: percent(c.threeBetCount, c.threeBetOpportunity),
    };
  }
}
