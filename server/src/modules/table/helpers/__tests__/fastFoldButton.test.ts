import { describe, it, expect } from 'vitest';
import { chooseFastFoldButtonSeat } from '../fastFoldButton.js';

const SEATS = [0, 1, 2, 3, 4, 5];
const blindsOf = (button: number, ring = SEATS) => {
  const i = ring.indexOf(button);
  return [ring[(i + 1) % ring.length], ring[(i + 2) % ring.length]];
};

describe('chooseFastFoldButtonSeat', () => {
  it('直前ハンドでブラインドを払った 2 人は SB/BB から外れる', () => {
    for (const recent of [[0, 1], [2, 5], [3, 4], [0, 3]]) {
      for (let k = 0; k < 20; k++) {
        const since = (s: number) => (recent.includes(s) ? 0 : 3);
        const button = chooseFastFoldButtonSeat(SEATS, since)!;
        for (const b of blindsOf(button)) expect(recent).not.toContain(b);
      }
    }
  });

  it('ブラインドから最も遠ざかっている 2 人に SB/BB が当たる', () => {
    const since = (s: number) => [1, 1, 5, 6, 1, 0][s];
    const button = chooseFastFoldButtonSeat(SEATS, since);
    expect(button).toBe(1);
    expect(blindsOf(1)).toEqual([2, 3]);
  });

  it('同点の候補は乱数で選ぶ', () => {
    const since = () => 6;
    expect(chooseFastFoldButtonSeat(SEATS, since, () => 0)).toBe(0);
    expect(chooseFastFoldButtonSeat(SEATS, since, () => 0.99)).toBe(5);
  });

  it('空席を飛ばしてリングを組む', () => {
    const ring = [0, 2, 3, 5];
    const since = (s: number) => (s === 5 || s === 0 ? 6 : 0);
    const button = chooseFastFoldButtonSeat(ring, since)!;
    expect(blindsOf(button, ring).sort()).toEqual([0, 5]);
  });

  it('3人未満なら null', () => {
    expect(chooseFastFoldButtonSeat([1, 4], () => 0)).toBeNull();
  });
});
