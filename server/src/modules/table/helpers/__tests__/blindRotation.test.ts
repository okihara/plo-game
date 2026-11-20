import { describe, it, expect } from 'vitest';
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
