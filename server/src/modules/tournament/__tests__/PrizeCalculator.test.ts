import { describe, it, expect } from 'vitest';
import { PrizeCalculator } from '../PrizeCalculator.js';

describe('PrizeCalculator', () => {
  describe('getDefaultPercentages', () => {
    it('6人以下は 65/35 配分', () => {
      expect(PrizeCalculator.getDefaultPercentages(6)).toEqual([65, 35]);
      expect(PrizeCalculator.getDefaultPercentages(2)).toEqual([65, 35]);
    });

    it('7-18人は 50/30/20 配分', () => {
      expect(PrizeCalculator.getDefaultPercentages(7)).toEqual([50, 30, 20]);
      expect(PrizeCalculator.getDefaultPercentages(18)).toEqual([50, 30, 20]);
    });

    it('19-27人は 45/25/18/12 配分', () => {
      expect(PrizeCalculator.getDefaultPercentages(19)).toEqual([45, 25, 18, 12]);
      expect(PrizeCalculator.getDefaultPercentages(27)).toEqual([45, 25, 18, 12]);
    });

    it('28人以上は 40/23/16/12/9 配分', () => {
      expect(PrizeCalculator.getDefaultPercentages(28)).toEqual([40, 23, 16, 12, 9]);
      expect(PrizeCalculator.getDefaultPercentages(100)).toEqual([40, 23, 16, 12, 9]);
    });
  });

  describe('calculate', () => {
    it('賞金配分を正しく計算する', () => {
      const prizes = PrizeCalculator.calculate(6, 600);
      expect(prizes).toEqual([
        { position: 1, percentage: 65, amount: 390 },
        { position: 2, percentage: 35, amount: 210 },
      ]);
    });

    it('カスタム配分率を使用できる', () => {
      const prizes = PrizeCalculator.calculate(10, 1000, [70, 30]);
      expect(prizes).toEqual([
        { position: 1, percentage: 70, amount: 700 },
        { position: 2, percentage: 30, amount: 300 },
      ]);
    });

    it('端数の余りが1位に加算され全額配分される', () => {
      const prizes = PrizeCalculator.calculate(6, 101);
      const totalDistributed = prizes.reduce((sum, p) => sum + p.amount, 0);
      expect(totalDistributed).toBe(101); // 全額配分される
      // 1位: floor(101*65/100)=65 + 余り1 = 66, 2位: floor(101*35/100)=35
      expect(prizes[0].amount).toBe(66);
      expect(prizes[1].amount).toBe(35);
    });

    it('端数がなければ全額配分される', () => {
      const prizes = PrizeCalculator.calculate(6, 600);
      const totalDistributed = prizes.reduce((sum, p) => sum + p.amount, 0);
      expect(totalDistributed).toBe(600);
    });
  });

  describe('getPrizeForPosition', () => {
    it('入賞順位の賞金を返す', () => {
      expect(PrizeCalculator.getPrizeForPosition(1, 6, 600)).toBe(390);
      expect(PrizeCalculator.getPrizeForPosition(2, 6, 600)).toBe(210);
    });

    it('入賞圏外は0を返す', () => {
      expect(PrizeCalculator.getPrizeForPosition(3, 6, 600)).toBe(0);
      expect(PrizeCalculator.getPrizeForPosition(10, 6, 600)).toBe(0);
    });
  });

  describe('isInTheMoney', () => {
    it('入賞圏内を正しく判定する', () => {
      expect(PrizeCalculator.isInTheMoney(1, 6)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(2, 6)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(3, 6)).toBe(false);
    });

    it('人数に応じて入賞圏が変わる', () => {
      // 18人: 3位まで入賞
      expect(PrizeCalculator.isInTheMoney(3, 18)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(4, 18)).toBe(false);
    });
  });
});
