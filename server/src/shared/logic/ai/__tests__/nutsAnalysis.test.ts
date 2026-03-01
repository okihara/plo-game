import { describe, it, expect } from 'vitest';
import { analyzeRiverNuts } from '../nutsAnalysis.js';
import { c } from './testHelpers.js';

describe('analyzeRiverNuts', () => {
  describe('ナッツ判定 (nutRank === 1)', () => {
    it('ナッツフラッシュ: Ah+Qh, ボードにハート3枚でAが最高', () => {
      const hole = [c('Ah'), c('Qh'), c('Td'), c('9c')];
      const board = [c('2h'), c('5h'), c('8h'), c('Kc'), c('3d')];
      // rank 6 = フラッシュ
      const result = analyzeRiverNuts(hole, board, 6, [14, 12]);
      // Ah+Qhのフラッシュ = ナッツフラッシュ（ストフラ不可のボードなら nutRank 1）
      expect(result.nutRank).toBeLessThanOrEqual(2);
      expect(result.possibleBetterHands).not.toContain('flush');
      expect(result.possibleBetterHands).not.toContain('better_flush');
    });

    it('ナッツフルハウス: ボードにペア + 最高ランクのセット', () => {
      // ボード: Ks Kd 7h 4c 2s → ペアボード
      // ホール: Kh Kc Jd Ts → クワッズK
      const hole = [c('Kh'), c('Kc'), c('Jd'), c('Ts')];
      const board = [c('Ks'), c('Kd'), c('7h'), c('4c'), c('2s')];
      // rank 8 = フォーカード
      const result = analyzeRiverNuts(hole, board, 8, [13]);
      expect(result.nutRank).toBe(1);
      expect(result.possibleBetterHands).toHaveLength(0);
    });
  });

  describe('セカンドナッツ以下', () => {
    it('Kh持ちフラッシュ: Ahが未使用なので better_flush が存在', () => {
      const hole = [c('Kh'), c('Jh'), c('Td'), c('9c')];
      const board = [c('2h'), c('5h'), c('8h'), c('Qc'), c('3d')];
      const result = analyzeRiverNuts(hole, board, 6, [13, 11]);
      // Ah + 何か のコンボが複数存在 → better_flush >= 1
      const betterFlushCount = result.possibleBetterHands.filter(h => h === 'better_flush').length;
      expect(betterFlushCount).toBeGreaterThanOrEqual(1);
      expect(result.nutRank).toBeGreaterThanOrEqual(2);
    });
  });

  describe('nutRank が高い（弱いハンド）', () => {
    it('ストレートだがフラッシュ可能ボード → nutRank >= 2', () => {
      // ボード: 6h 7h 8h Kc 2d → ハート3枚でフラッシュ可能
      // ホール: 9d Td Jc 3s → 9-T で T-high ストレート (6-7-8-9-T)
      const hole = [c('9d'), c('Td'), c('Jc'), c('3s')];
      const board = [c('6h'), c('7h'), c('8h'), c('Kc'), c('2d')];
      const result = analyzeRiverNuts(hole, board, 5, [10]);
      // フラッシュが可能なのでストレートはナッツではない
      expect(result.possibleBetterHands).toContain('flush');
      expect(result.nutRank).toBeGreaterThanOrEqual(2);
    });

    it('ツーペアでペアなしボード → nutRank >= 2', () => {
      // ボード: Ah 9c 6d 3s 2h → ペアなし、ハート2枚（フラッシュ不可）
      // ホール: Ad 9h Jc Ts → A9ツーペア (rank 3)
      const hole = [c('Ad'), c('9h'), c('Jc'), c('Ts')];
      const board = [c('Ah'), c('9c'), c('6d'), c('3s'), c('2h')];
      const result = analyzeRiverNuts(hole, board, 3, [14, 9]);
      // ストレート（4-5でホイール等）が可能 → ツーペアはナッツではない
      expect(result.nutRank).toBeGreaterThanOrEqual(2);
      expect(result.possibleBetterHands.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('possibleBetterHands の正確性', () => {
    it('フラッシュ可能ボードで flush が含まれる', () => {
      // ボード: 2h 5h 9h Kc 3d → ハート3枚
      const hole = [c('Ad'), c('Kd'), c('Qc'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
      // ワンペアK (rank 2)
      const result = analyzeRiverNuts(hole, board, 2, [13]);
      expect(result.possibleBetterHands).toContain('flush');
    });

    it('ペアボードで full_house が含まれる', () => {
      // ボード: Ks Kd 7h 4c 2s → Kのペア
      const hole = [c('Ah'), c('Qh'), c('Jd'), c('Ts')];
      const board = [c('Ks'), c('Kd'), c('7h'), c('4c'), c('2s')];
      // ワンペア (rank 2)
      const result = analyzeRiverNuts(hole, board, 2, [14]);
      expect(result.possibleBetterHands).toContain('full_house');
    });

    it('ストレートがより高い場合 better_straight が含まれる', () => {
      // ボード: 5c 6d 7h Ts 2c → コネクテッド
      // ホール: 3d 4h Jc Qs → 3-4 でロウストレート (3-4-5-6-7)
      const hole = [c('3d'), c('4h'), c('Jc'), c('Qs')];
      const board = [c('5c'), c('6d'), c('7h'), c('Ts'), c('2c')];
      const result = analyzeRiverNuts(hole, board, 5, [7]);
      // 8-9 で高いストレートが可能
      expect(result.possibleBetterHands).toContain('better_straight');
    });
  });

  describe('エッジケース', () => {
    it('5枚未満のコミュニティ → デフォルト値', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h')]; // フロップ3枚
      const result = analyzeRiverNuts(hole, board, 6, [14]);
      expect(result.nutRank).toBe(1);
      expect(result.possibleBetterHands).toHaveLength(0);
    });

    it('モノトーンボード（5枚全て同スート）', () => {
      // ボード全てハート
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('7h'), c('9h'), c('Th')];
      // Ah + Kh でナッツフラッシュ (rank 6)
      const result = analyzeRiverNuts(hole, board, 6, [14, 13]);
      expect(result.nutRank).toBeLessThanOrEqual(2);
    });

    it('absoluteNutType がセットされる', () => {
      const hole = [c('Ah'), c('Kh'), c('Qd'), c('Js')];
      const board = [c('2h'), c('5h'), c('9h'), c('Kc'), c('3d')];
      const result = analyzeRiverNuts(hole, board, 6, [14]);
      expect(result.absoluteNutType).toBeDefined();
      expect(typeof result.absoluteNutType).toBe('string');
    });
  });
});
