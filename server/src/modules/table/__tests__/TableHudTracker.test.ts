// TableHudTracker: DB の累計（非同期読み込み）と、この卓で終わったハンドの足し合わせ
import { describe, it, expect, vi } from 'vitest';
import type { PlayerHudStats } from '@plo/shared';
import { TableHudTracker } from '../helpers/TableHudTracker.js';
import { emptyHud } from '../../stats/hudStats.js';
import type { GameState } from '../../../shared/logic/types.js';
import type { SeatInfo } from '../types.js';

/** 外から resolve / reject できる Promise */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function dbHud(hands: number): PlayerHudStats {
  return { ...emptyHud(), hands, vpip: { n: 0, d: hands } };
}

// 3人卓・ディーラー席0: BTN=A, SB=B, BB=C。A がレイズ、B・C がフォールド
const seats = [{ odId: 'A' }, { odId: 'B' }, { odId: 'C' }] as SeatInfo[];
const startChips = new Map([[0, 200], [1, 200], [2, 200]]);
const raiseFoldHand = {
  handHistory: [
    { playerId: 0, action: 'raise', amount: 7, street: 'preflop' },
    { playerId: 1, action: 'fold', amount: 0, street: 'preflop' },
    { playerId: 2, action: 'fold', amount: 0, street: 'preflop' },
  ],
  dealerPosition: 0,
  smallBlind: 1,
  bigBlind: 2,
} as unknown as GameState;

const flush = () => new Promise(r => setTimeout(r, 0));

describe('TableHudTracker', () => {
  it('読み込み中に終わったハンドも、読み込み後の値に含める', async () => {
    const load = deferred<PlayerHudStats>();
    const onUpdate = vi.fn();
    const tracker = new TableHudTracker(() => load.promise, onUpdate);

    tracker.load('A');
    tracker.recordHand(raiseFoldHand, seats, startChips);
    expect(tracker.get('A')).toBeUndefined();

    load.resolve(dbHud(10));
    await flush();

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(tracker.get('A')).toMatchObject({ hands: 11, vpip: { n: 1, d: 11 }, pfr: { n: 1, d: 1 } });
  });

  it('座り直したら古い読み込み結果は捨て、この卓の分も数え直す', async () => {
    const first = deferred<PlayerHudStats>();
    const second = deferred<PlayerHudStats>();
    const loader = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const tracker = new TableHudTracker(loader, () => {});

    tracker.load('A');
    tracker.recordHand(raiseFoldHand, seats, startChips);
    // 座り直し: 2回目の読み込みは 1回目のハンドを DB から含んだ値を返す
    tracker.load('A');
    second.resolve(dbHud(11));
    first.resolve(dbHud(10));
    await flush();

    expect(tracker.get('A')?.hands).toBe(11);
  });

  it('読み込みを始めていない人の分は数えない', async () => {
    const tracker = new TableHudTracker(() => Promise.resolve(dbHud(5)), () => {});
    tracker.load('A');
    tracker.recordHand(raiseFoldHand, seats, startChips);
    await flush();

    expect(tracker.get('A')?.hands).toBe(6);
    expect(tracker.get('B')).toBeUndefined();
  });

  it('読み込みに失敗したら HUD を出さない', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = new TableHudTracker(() => Promise.reject(new Error('db down')), () => {});
    tracker.load('A');
    await flush();

    expect(tracker.get('A')).toBeUndefined();
    errorSpy.mockRestore();
  });
});
