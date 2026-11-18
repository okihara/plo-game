import { describe, it, expect } from 'vitest';
import { chooseFastFoldButtonSeat } from '../blindRotation.js';

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

import { predictNextBlindSeats, chooseSeatAvoidingBlinds } from '../blindRotation.js';

describe('predictNextBlindSeats', () => {
  it('ボタンは前回ボタンの次の着席者へ進み、その次が SB、さらに次が BB', () => {
    expect(predictNextBlindSeats([0, 1, 2, 3, 4, 5], 2, 6)).toEqual([4, 5]);
    expect(predictNextBlindSeats([0, 1, 2, 3, 4, 5], 4, 6)).toEqual([0, 1]);
  });
  it('空席を飛ばす', () => {
    expect(predictNextBlindSeats([0, 2, 5], 2, 6)).toEqual([0, 2]);
  });
  it('前回ボタン未設定なら席 0 の次がボタン', () => {
    expect(predictNextBlindSeats([0, 1, 2, 3], -1, 6)).toEqual([2, 3]);
  });
  it('ヘッズアップはボタンが SB', () => {
    expect(predictNextBlindSeats([1, 4], 1, 6)).toEqual([4, 1]);
  });
});

describe('chooseSeatAvoidingBlinds', () => {
  const X = {};
  it('直前にブラインドを払った人は、次ハンドで SB/BB になる席を避ける', () => {
    // 席0,1,2,4 着席・前回ボタン=0 → 空席 3 に座ると次ハンドは BTN=1, SB=2, BB=3
    const seats = [X, X, X, null, X, null];
    for (let k = 0; k < 20; k++) {
      expect(chooseSeatAvoidingBlinds({ seats, lastDealer: 0, handsSinceBlind: 0 })).toBe(5);
    }
  });
  it('しばらくブラインドを払っていない人は従来どおり先頭の空席', () => {
    const seats = [X, X, X, null, X, null];
    expect(chooseSeatAvoidingBlinds({ seats, lastDealer: 0, handsSinceBlind: 3 })).toBe(3);
    expect(chooseSeatAvoidingBlinds({ seats, lastDealer: 0, handsSinceBlind: undefined })).toBe(3);
  });
  it('避けられる席がなければ先頭の空席', () => {
    const seats = [X, X, X, null, X, X];
    expect(chooseSeatAvoidingBlinds({ seats, lastDealer: 0, handsSinceBlind: 0 })).toBe(3);
  });
  it('空席がなければ null', () => {
    expect(chooseSeatAvoidingBlinds({ seats: [X, X], lastDealer: 0, handsSinceBlind: 0 })).toBeNull();
  });
});
