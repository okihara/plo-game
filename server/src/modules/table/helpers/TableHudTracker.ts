// 卓内 HUD: この卓で遊んだハンドだけからプレイヤーごとの簡易スタッツを集計する（メモリのみ、卓と寿命を共にする）

import type { PlayerHudStats } from '@plo/shared';
import { GameState } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { computeHandIncrements, toActionEntries } from '../../stats/handIncrements.js';
import { computeFlopHudIncrement, FlopHudIncrement } from '../../stats/statsComputation.js';

interface HudCounts extends FlopHudIncrement {
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
    const actions = toActionEntries(gameState, seats);
    for (const { odId, inc } of computeHandIncrements(gameState, seats, startChips)) {
      const flop = computeFlopHudIncrement(odId, actions);
      const c = this.counts.get(odId) ?? {
        detailedHands: 0, vpipCount: 0, pfrCount: 0, threeBetCount: 0, threeBetOpportunity: 0,
        donkCount: 0, donkOpportunity: 0, checkRaiseCount: 0, checkRaiseOpportunity: 0, bmcbCount: 0, bmcbOpportunity: 0,
      };
      c.detailedHands += inc.detailedHands;
      c.vpipCount += inc.vpipCount;
      c.pfrCount += inc.pfrCount;
      c.threeBetCount += inc.threeBetCount;
      c.threeBetOpportunity += inc.threeBetOpportunity;
      c.donkCount += flop.donkCount;
      c.donkOpportunity += flop.donkOpportunity;
      c.checkRaiseCount += flop.checkRaiseCount;
      c.checkRaiseOpportunity += flop.checkRaiseOpportunity;
      c.bmcbCount += flop.bmcbCount;
      c.bmcbOpportunity += flop.bmcbOpportunity;
      this.counts.set(odId, c);
    }
  }

  get(odId: string): PlayerHudStats | undefined {
    const c = this.counts.get(odId);
    if (!c) return undefined;
    return {
      vpip: percent(c.vpipCount, c.detailedHands),
      pfr: percent(c.pfrCount, c.detailedHands),
      threeBet: percent(c.threeBetCount, c.threeBetOpportunity),
      donk: percent(c.donkCount, c.donkOpportunity),
      checkRaise: percent(c.checkRaiseCount, c.checkRaiseOpportunity),
      bmcb: percent(c.bmcbCount, c.bmcbOpportunity),
    };
  }
}
