// プライベート卓 HUD: DB の累計（着席時に読み込み）に、この卓で読み込み後に終わったハンドを足して返す

import type { PlayerHudStats } from '@plo/shared';
import { GameState } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { addHud, computeHandHud, emptyHud } from '../../stats/hudStats.js';

export type HudLoader = (odId: string, before: Date) => Promise<PlayerHudStats>;

export class TableHudTracker {
  /** DB から読んだ累計（読み込み完了まで無い） */
  private readonly base = new Map<string, PlayerHudStats>();
  /** 読み込み開始以降にこの卓で終わったハンドの分 */
  private readonly live = new Map<string, PlayerHudStats>();
  private readonly loadSeq = new Map<string, number>();

  constructor(
    private readonly loader: HudLoader,
    private readonly onUpdate: () => void,
  ) {}

  /** 着席時に呼ぶ。他の卓で遊んだ分も反映するため毎回読み直す */
  load(odId: string): void {
    const seq = (this.loadSeq.get(odId) ?? 0) + 1;
    this.loadSeq.set(odId, seq);
    this.base.delete(odId);
    this.live.set(odId, emptyHud());
    this.loader(odId, new Date())
      .then(hud => {
        if (this.loadSeq.get(odId) !== seq) return;
        this.base.set(odId, hud);
        this.onUpdate();
      })
      .catch(err => console.error(`HUD load failed for ${odId}:`, err));
  }

  recordHand(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    startChips: Map<number, number>,
  ): void {
    const players = seats.flatMap((seat, i) => (seat && startChips.has(i) ? [{ seatIndex: i, odId: seat.odId }] : []));
    const huds = computeHandHud({
      actions: gameState.handHistory.map(a => ({
        seatIndex: a.playerId,
        odId: seats[a.playerId]?.odId ?? `seat_${a.playerId}`,
        action: a.action,
        amount: a.amount,
        street: a.street,
      })),
      dealerPosition: gameState.dealerPosition,
      players,
      smallBlind: gameState.smallBlind,
      bigBlind: gameState.bigBlind,
    });
    for (const [odId, hud] of huds) {
      const live = this.live.get(odId);
      if (live) this.live.set(odId, addHud(live, hud));
    }
  }

  get(odId: string): PlayerHudStats | undefined {
    const base = this.base.get(odId);
    if (!base) return undefined;
    const hud = addHud(base, this.live.get(odId) ?? emptyHud());
    return hud.hands > 0 ? hud : undefined;
  }
}
