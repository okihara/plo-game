import { describe, it, expect } from 'vitest';
import { outsToEquity, estimateHandEquity, countOuts } from '../equityEstimator.js';
import { c } from './testHelpers.js';

describe('outsToEquity', () => {
  it('0アウツ → 0', () => {
    expect(outsToEquity(0, 'flop')).toBe(0);
    expect(outsToEquity(0, 'turn')).toBe(0);
  });

  it('フロップ: アウツ × 4% (8以下)', () => {
    // 8 outs × 4% = 32%
    expect(outsToEquity(8, 'flop')).toBeCloseTo(0.32, 2);
    // 4 outs × 4% = 16%
    expect(outsToEquity(4, 'flop')).toBeCloseTo(0.16, 2);
  });

  it('フロップ: 8アウツ以上は補正あり', () => {
    // 12 outs: 12 × 4% - (12-8) × 1% = 48% - 4% = 44%
    expect(outsToEquity(12, 'flop')).toBeCloseTo(0.44, 2);
    // 15 outs: 15 × 4% - 7 × 1% = 60% - 7% = 53%
    expect(outsToEquity(15, 'flop')).toBeCloseTo(0.53, 2);
  });

  it('ターン: アウツ × 2%', () => {
    // 8 outs × 2% = 16%
    expect(outsToEquity(8, 'turn')).toBeCloseTo(0.16, 2);
    // 15 outs × 2% = 30%
    expect(outsToEquity(15, 'turn')).toBeCloseTo(0.30, 2);
  });

  it('リバー → 0', () => {
    expect(outsToEquity(10, 'river')).toBe(0);
  });

  it('上限65%にキャップ', () => {
    // 非常に多いアウツでも65%を超えない
    expect(outsToEquity(30, 'flop')).toBeLessThanOrEqual(0.65);
  });
});

describe('estimateHandEquity', () => {
  it('高ランク（フルハウス）は高エクイティ', () => {
    const hole = [c('Ah'), c('Ad'), c('Kh'), c('Kd')];
    const board = [c('As'), c('Ks'), c('2c'), c('5d'), c('8h')];
    // rank 7 = フルハウス
    const equity = estimateHandEquity(hole, board, 7, 'river', 1);
    expect(equity).toBeGreaterThan(0.8);
  });

  it('低ランク（ハイカード）は低エクイティ', () => {
    const hole = [c('3h'), c('4d'), c('6c'), c('9s')];
    const board = [c('As'), c('Ks'), c('2c'), c('5d'), c('8h')];
    // rank 1 = ハイカード
    const equity = estimateHandEquity(hole, board, 1, 'river', 1);
    expect(equity).toBeLessThan(0.2);
  });

  it('対戦人数が多いとエクイティが割引される', () => {
    const hole = [c('Ah'), c('Ad'), c('Kh'), c('Kd')];
    const board = [c('As'), c('Qs'), c('2c'), c('5d'), c('8h')];
    const eq1 = estimateHandEquity(hole, board, 4, 'river', 1);
    const eq3 = estimateHandEquity(hole, board, 4, 'river', 3);
    expect(eq3).toBeLessThan(eq1);
  });

  it('フロップではドローエクイティが加算される', () => {
    // フラッシュドロー持ち: ホール2枚ハート + コミュニティ2枚ハート
    const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
    const board = [c('2h'), c('5h'), c('9c')]; // フロップ3枚
    const eqFlop = estimateHandEquity(hole, board, 2, 'flop', 1);
    const eqRiver = estimateHandEquity(hole, board, 2, 'river', 1);
    // フロップのエクイティ >= リバーのエクイティ（ドロー分）
    expect(eqFlop).toBeGreaterThanOrEqual(eqRiver);
  });

  it('エクイティは0-1の範囲', () => {
    const hole = [c('Ah'), c('Ad'), c('Kh'), c('Kd')];
    const board = [c('As'), c('Ac'), c('2c'), c('5d'), c('8h')];
    const equity = estimateHandEquity(hole, board, 8, 'river', 1);
    expect(equity).toBeGreaterThanOrEqual(0);
    expect(equity).toBeLessThanOrEqual(1);
  });
});

describe('countOuts', () => {
  it('リバー（5枚）では全て0', () => {
    const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
    const board = [c('2h'), c('5h'), c('9c'), c('Td'), c('3s')];
    const result = countOuts(hole, board, 2);
    expect(result.totalOuts).toBe(0);
    expect(result.flushOuts).toBe(0);
    expect(result.straightOuts).toBe(0);
  });

  it('フロップ3枚未満では全て0', () => {
    const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
    const board = [c('2h'), c('5h')]; // 2枚のみ
    const result = countOuts(hole, board, 2);
    expect(result.totalOuts).toBe(0);
  });

  it('フラッシュドローのアウツが正の値', () => {
    // ホール: Ah Kh + 2枚別スート、ボード: 2h 5h 9c → ハートFD
    const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
    const board = [c('2h'), c('5h'), c('9c')];
    const result = countOuts(hole, board, 2);
    expect(result.totalOuts).toBeGreaterThan(0);
  });

  it('totalOuts は flushOuts + straightOuts 以上', () => {
    const hole = [c('Ah'), c('Kh'), c('Td'), c('9d')];
    const board = [c('2h'), c('5h'), c('8c')];
    const result = countOuts(hole, board, 2);
    expect(result.totalOuts).toBeGreaterThanOrEqual(result.flushOuts + result.straightOuts);
  });
});
