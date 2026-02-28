import { describe, it, expect } from 'vitest';
import { analyzeBoard, boardScaryness } from '../boardAnalysis.js';
import { c } from './testHelpers.js';

describe('analyzeBoard', () => {
  describe('スート分析', () => {
    it('モノトーン: 同スート3枚のフロップ', () => {
      const board = [c('2h'), c('7h'), c('Jh')];
      const result = analyzeBoard(board);
      expect(result.monotone).toBe(true);
      expect(result.flushPossible).toBe(true);
      expect(result.rainbow).toBe(false);
      expect(result.twoTone).toBe(false);
    });

    it('レインボー: 3枚全て異なるスート', () => {
      const board = [c('2h'), c('7d'), c('Jc')];
      const result = analyzeBoard(board);
      expect(result.rainbow).toBe(true);
      expect(result.monotone).toBe(false);
      expect(result.flushPossible).toBe(false);
    });

    it('ツートーン: 2枚同スート + 1枚別スート', () => {
      const board = [c('2h'), c('7h'), c('Jc')];
      const result = analyzeBoard(board);
      expect(result.twoTone).toBe(true);
      expect(result.monotone).toBe(false);
      expect(result.rainbow).toBe(false);
      expect(result.flushDraw).toBe(true);
    });
  });

  describe('ペアボード', () => {
    it('ペアボード: 同ランク2枚', () => {
      const board = [c('7h'), c('7d'), c('Jc')];
      const result = analyzeBoard(board);
      expect(result.isPaired).toBe(true);
      expect(result.isTrips).toBe(false);
    });

    it('トリップスボード: 同ランク3枚', () => {
      const board = [c('7h'), c('7d'), c('7c')];
      const result = analyzeBoard(board);
      expect(result.isPaired).toBe(true);
      expect(result.isTrips).toBe(true);
    });

    it('ペアなしボード', () => {
      const board = [c('2h'), c('7d'), c('Jc')];
      const result = analyzeBoard(board);
      expect(result.isPaired).toBe(false);
      expect(result.isTrips).toBe(false);
    });
  });

  describe('コネクティビティ', () => {
    it('コネクテッド: 連続した3枚 (7-8-9)', () => {
      const board = [c('7h'), c('8d'), c('9c')];
      const result = analyzeBoard(board);
      expect(result.isConnected).toBe(true);
      expect(result.straightPossible).toBe(true);
    });

    it('ギャップ付きコネクト: 6-8-9（gap ≤ 2）', () => {
      const board = [c('6h'), c('8d'), c('9c')];
      const result = analyzeBoard(board);
      expect(result.isConnected).toBe(true);
    });

    it('非コネクテッド: 離れた3枚 (2-7-K)', () => {
      const board = [c('2h'), c('7d'), c('Kc')];
      const result = analyzeBoard(board);
      expect(result.isConnected).toBe(false);
      expect(result.straightPossible).toBe(false);
    });
  });

  describe('ウェット/ドライ', () => {
    it('ウェットボード: フラッシュドロー + コネクテッド', () => {
      const board = [c('7h'), c('8h'), c('9c')];
      const result = analyzeBoard(board);
      expect(result.isWet).toBe(true);
    });

    it('ドライボード: レインボー + 非コネクテッド', () => {
      const board = [c('2h'), c('7d'), c('Kc')];
      const result = analyzeBoard(board);
      expect(result.isWet).toBe(false);
    });
  });

  describe('ブロードウェイ', () => {
    it('ブロードウェイ2枚以上: T+が2枚', () => {
      const board = [c('Th'), c('Jd'), c('3c')];
      const result = analyzeBoard(board);
      expect(result.hasBroadway).toBe(true);
    });

    it('ブロードウェイなし: T未満のみ', () => {
      const board = [c('2h'), c('5d'), c('8c')];
      const result = analyzeBoard(board);
      expect(result.hasBroadway).toBe(false);
    });
  });

  describe('ダイナミズム', () => {
    it('フロップではダイナミズム > 0', () => {
      const board = [c('7h'), c('8d'), c('9c')];
      const result = analyzeBoard(board);
      expect(result.dynamism).toBeGreaterThan(0);
    });

    it('リバー（5枚）ではダイナミズム = 0', () => {
      const board = [c('7h'), c('8d'), c('9c'), c('Ks'), c('2h')];
      const result = analyzeBoard(board);
      expect(result.dynamism).toBe(0);
    });
  });

  describe('averageRank', () => {
    it('平均ランクが正しい', () => {
      // 2=2, 7=7, A=14 → avg = (2+7+14)/3 = 7.67
      const board = [c('2h'), c('7d'), c('Ac')];
      const result = analyzeBoard(board);
      expect(result.averageRank).toBeCloseTo(7.67, 1);
    });
  });

  describe('highCard', () => {
    it('ボードの最高ランクが正しい', () => {
      const board = [c('2h'), c('7d'), c('Kc')];
      const result = analyzeBoard(board);
      expect(result.highCard).toBe(13); // K=13
    });

    it('Aがある場合は14', () => {
      const board = [c('2h'), c('7d'), c('Ac')];
      const result = analyzeBoard(board);
      expect(result.highCard).toBe(14);
    });
  });
});

describe('boardScaryness', () => {
  it('フラッシュ+ストレート可能 → 高いスコア', () => {
    const board = analyzeBoard([c('7h'), c('8h'), c('9h')]);
    const scary = boardScaryness(board);
    expect(scary).toBeGreaterThanOrEqual(0.5);
  });

  it('ドライレインボー → 低いスコア', () => {
    const board = analyzeBoard([c('2h'), c('7d'), c('Kc')]);
    const scary = boardScaryness(board);
    expect(scary).toBeLessThan(0.3);
  });

  it('スコアは0-1の範囲', () => {
    const board = analyzeBoard([c('7h'), c('8h'), c('9h'), c('Th'), c('Jh')]);
    const scary = boardScaryness(board);
    expect(scary).toBeGreaterThanOrEqual(0);
    expect(scary).toBeLessThanOrEqual(1);
  });
});
