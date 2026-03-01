import { describe, it, expect } from 'vitest';
import { analyzeBlockers, bluffBlockerValue } from '../blockerAnalysis.js';
import { c } from './testHelpers.js';

describe('analyzeBlockers', () => {
  describe('ナッツフラッシュブロック', () => {
    it('フラッシュ可能ボード + そのスートのAをホールに持つ', () => {
      const hole = [c('Ah'), c('Kd'), c('Qc'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksNutFlush).toBe(true);
    });

    it('フラッシュ可能ボードだがAを持っていない', () => {
      const hole = [c('Kh'), c('Jd'), c('Qc'), c('Ts')];
      const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksNutFlush).toBe(false);
    });

    it('フラッシュ不可能ボード → ブロックなし', () => {
      const hole = [c('Ah'), c('Kd'), c('Qc'), c('Js')];
      const board = [c('2h'), c('5d'), c('9c'), c('Ks'), c('3h')]; // max 2枚同スート
      const result = analyzeBlockers(hole, board);
      expect(result.blocksNutFlush).toBe(false);
    });
  });

  describe('ナッツストレートブロック', () => {
    it('ボード最高値+1,+2を持つ', () => {
      // ボード: 7d 8c 9h 3s 2d → 最高値9、ナッツストレートにはT,Jが必要
      const hole = [c('Th'), c('Jd'), c('2c'), c('3h')];
      const board = [c('7d'), c('8c'), c('9h'), c('3s'), c('2d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksNutStraight).toBe(true);
    });

    it('ボード最高値+1,+2を持たない', () => {
      const hole = [c('2h'), c('3d'), c('4c'), c('5s')];
      const board = [c('7d'), c('8c'), c('9h'), c('Ks'), c('Ad')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksNutStraight).toBe(false);
    });
  });

  describe('トップセットブロック', () => {
    it('ボード最高ランクを1枚持つ', () => {
      const hole = [c('Kh'), c('Jd'), c('Qc'), c('Ts')];
      const board = [c('Kd'), c('7c'), c('3h'), c('2s'), c('5d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksTopSet).toBe(true);
    });

    it('ボード最高ランクを持たない', () => {
      const hole = [c('Jh'), c('Td'), c('9c'), c('8s')];
      const board = [c('Kd'), c('7c'), c('3h'), c('2s'), c('5d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blocksTopSet).toBe(false);
    });
  });

  describe('blockerScore', () => {
    it('複数のブロッカーがあればスコアが高い', () => {
      // フラッシュ可能ボード + Ah持ち + ボードハイを持つ
      const hole = [c('Ah'), c('Kd'), c('Jc'), c('Ts')];
      const board = [c('2h'), c('5h'), c('Kh'), c('7c'), c('3d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blockerScore).toBeGreaterThan(0.3);
    });

    it('ブロッカーがなければスコアが低い', () => {
      const hole = [c('2c'), c('3d'), c('4s'), c('5c')];
      const board = [c('Ah'), c('Kh'), c('Qh'), c('7d'), c('8c')];
      const result = analyzeBlockers(hole, board);
      expect(result.blockerScore).toBeLessThanOrEqual(0.1);
    });

    it('スコアは0-1の範囲', () => {
      const hole = [c('Ah'), c('Kd'), c('Qc'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
      const result = analyzeBlockers(hole, board);
      expect(result.blockerScore).toBeGreaterThanOrEqual(0);
      expect(result.blockerScore).toBeLessThanOrEqual(1);
    });
  });
});

describe('bluffBlockerValue', () => {
  it('ナッツフラッシュブロッカーは高い価値', () => {
    const hole = [c('Ah'), c('2d'), c('3c'), c('4s')];
    const board = [c('5h'), c('8h'), c('Jh'), c('Kc'), c('2s')];
    const value = bluffBlockerValue(hole, board);
    expect(value).toBeGreaterThanOrEqual(0.3);
  });

  it('ブロッカーなしは低い価値', () => {
    const hole = [c('2c'), c('3d'), c('4s'), c('6c')];
    const board = [c('Ah'), c('Kh'), c('Qh'), c('7d'), c('8c')];
    const value = bluffBlockerValue(hole, board);
    expect(value).toBeLessThan(0.2);
  });

  it('価値は0-1の範囲', () => {
    const hole = [c('Ah'), c('Kd'), c('Qc'), c('Js')];
    const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
    const value = bluffBlockerValue(hole, board);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});
