// 卓内 HUD: DB の累計（着席時に読み込み）に、読み込み後に終わったハンドを足して返す。
// プライベート卓は卓ごとに持ち、トナメは1つを全卓で共有する（卓移動しても引き継ぐ）

import type { PlayerHudStats } from '@plo/shared';
import { GameState } from '../../../shared/logic/types.js';
import { SeatInfo } from '../types.js';
import { addHud, computeHandHudFromGameState, emptyHud } from '../../stats/hudStats.js';

export type HudLoader = (odId: string, before: Date) => Promise<PlayerHudStats>;

export class TableHudTracker {
  /** DB から読んだ累計（読み込み完了まで無い） */
  private readonly base = new Map<string, PlayerHudStats>();
  /** 読み込み開始以降にこの卓で終わったハンドの分 */
  private readonly live = new Map<string, PlayerHudStats>();
  private readonly loadSeq = new Map<string, number>();

  constructor(
    private readonly loader: HudLoader,
    /** 読み込み完了時に呼ぶ。トナメは本人が今いる卓にだけ配信するため odId を渡す */
    private readonly onUpdate: (odId: string) => void,
    /** true: 一度読み込んだ人は読み直さない（トナメの卓移動のたびに DB を読まないため） */
    private readonly loadOnce = false,
  ) {}

  /** 着席時に呼ぶ。プライベート卓は他の卓で遊んだ分も反映するため毎回読み直す */
  load(odId: string): void {
    if (this.loadOnce && this.loadSeq.has(odId)) return;
    const seq = (this.loadSeq.get(odId) ?? 0) + 1;
    this.loadSeq.set(odId, seq);
    this.base.delete(odId);
    this.live.set(odId, emptyHud());
    this.loader(odId, new Date())
      .then(hud => {
        if (this.loadSeq.get(odId) !== seq) return;
        this.base.set(odId, hud);
        this.onUpdate(odId);
      })
      .catch(err => console.error(`HUD load failed for ${odId}:`, err));
  }

  recordHand(
    gameState: GameState,
    seats: (SeatInfo | null)[],
    startChips: Map<number, number>,
  ): void {
    const huds = computeHandHudFromGameState(gameState, seats, startChips);
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
