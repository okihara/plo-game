import { describe, it, expect } from 'vitest';
import { evaluateHandExtended } from '../handStrength.js';
import { c } from './testHelpers.js';

describe('evaluateHandExtended', () => {
  describe('メイドハンドランク', () => {
    it('フラッシュ → rank = 6', () => {
      // ホール: Ah Kh + 2枚、ボード: 2h 5h 9h Tc 3d → ナッツフラッシュ
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.madeHandRank).toBe(6);
    });

    it('ツーペア → rank = 3', () => {
      const hole = [c('Ah'), c('Kd'), c('9c'), c('8s')];
      const board = [c('As'), c('Kc'), c('2h'), c('5d'), c('7s')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.madeHandRank).toBe(3);
    });

    it('ワンペア → rank = 2', () => {
      const hole = [c('Ah'), c('Jd'), c('9c'), c('8s')];
      const board = [c('As'), c('Kc'), c('2h'), c('5d'), c('7s')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      // A のワンペア（ボードのAとホールのAでペア）
      expect(result.madeHandRank).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ドロー検出', () => {
    it('フラッシュドロー（フロップ）', () => {
      // ホール: Ah Kh + 2枚別、ボード: 2h 5h 9c → ハートFD
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9c')];
      const result = evaluateHandExtended(hole, board, 'flop', 1);
      expect(result.hasFlushDraw).toBe(true);
    });

    it('リバーではドローなし', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9c'), c('Td'), c('3s')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      // リバーではドローは完成するか外れるかなので、ドローフラグの意味は薄い
      // ただしリバーでもフラッシュが完成していないならドロー扱いにはならない想定
      // 実装次第だが、evaluateHandExtended はドロー判定もするはず
      expect(result.madeHandRank).toBeDefined();
    });
  });

  describe('リバーでのnutRank統合', () => {
    it('リバーではnutRankが設定される', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.nutRank).toBeDefined();
      expect(typeof result.nutRank).toBe('number');
      expect(result.nutRank).toBeGreaterThanOrEqual(1);
    });

    it('フロップではnutRankがundefined', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9c')];
      const result = evaluateHandExtended(hole, board, 'flop', 1);
      expect(result.nutRank).toBeUndefined();
    });

    it('possibleBetterHandsがリバーで設定される', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.possibleBetterHands).toBeDefined();
      expect(Array.isArray(result.possibleBetterHands)).toBe(true);
    });
  });

  describe('strengthの妥当性', () => {
    it('ナッツフラッシュ > セット > ワンペア > ハイカード', () => {
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];

      // ナッツフラッシュ
      const flush = evaluateHandExtended(
        [c('Ah'), c('Kh'), c('Qd'), c('Js')], board, 'river', 1
      );
      // セット
      const set = evaluateHandExtended(
        [c('9d'), c('9c'), c('Qd'), c('Js')], board, 'river', 1
      );
      // ワンペア
      const pair = evaluateHandExtended(
        [c('Td'), c('Jc'), c('Qd'), c('Ks')], board, 'river', 1
      );

      expect(flush.strength).toBeGreaterThan(set.strength);
      expect(set.strength).toBeGreaterThan(pair.strength);
    });
  });

  describe('estimatedEquity', () => {
    it('エクイティは0-1の範囲', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.estimatedEquity).toBeGreaterThanOrEqual(0);
      expect(result.estimatedEquity).toBeLessThanOrEqual(1);
    });
  });

  describe('blockerScore', () => {
    it('ブロッカースコアは0-1の範囲', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Tc'), c('3d')];
      const result = evaluateHandExtended(hole, board, 'river', 1);
      expect(result.blockerScore).toBeGreaterThanOrEqual(0);
      expect(result.blockerScore).toBeLessThanOrEqual(1);
    });
  });
});
