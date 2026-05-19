import { describe, it, expect } from 'vitest';
import { PrizeCalculator } from '../PrizeCalculator.js';

describe('PrizeCalculator', () => {
  describe('getDefaultPaidPlaces', () => {
    it('リエントリー込みの総エントリー数の上位15%を切り捨て、最低1名は入賞させる', () => {
      expect(PrizeCalculator.getDefaultPaidPlaces(0)).toBe(0);
      expect(PrizeCalculator.getDefaultPaidPlaces(6)).toBe(1);
      expect(PrizeCalculator.getDefaultPaidPlaces(7)).toBe(1);
      expect(PrizeCalculator.getDefaultPaidPlaces(18)).toBe(2);
      expect(PrizeCalculator.getDefaultPaidPlaces(27)).toBe(4);
      expect(PrizeCalculator.getDefaultPaidPlaces(100)).toBe(15);
    });

    it('15%の境界で入賞順位数が増える', () => {
      expect(PrizeCalculator.getDefaultPaidPlaces(1)).toBe(1);
      expect(PrizeCalculator.getDefaultPaidPlaces(13)).toBe(1);
      expect(PrizeCalculator.getDefaultPaidPlaces(14)).toBe(2);
      expect(PrizeCalculator.getDefaultPaidPlaces(20)).toBe(3);
      expect(PrizeCalculator.getDefaultPaidPlaces(21)).toBe(3);
      expect(PrizeCalculator.getDefaultPaidPlaces(33)).toBe(4);
      expect(PrizeCalculator.getDefaultPaidPlaces(34)).toBe(5);
      expect(PrizeCalculator.getDefaultPaidPlaces(40)).toBe(6);
      expect(PrizeCalculator.getDefaultPaidPlaces(101)).toBe(15);
      expect(PrizeCalculator.getDefaultPaidPlaces(107)).toBe(16);
    });
  });

  describe('getDefaultPercentages', () => {
    it('入賞順位数に応じた固定配分を返す', () => {
      expect(PrizeCalculator.getDefaultPercentages(6)).toEqual([100]);
      expect(PrizeCalculator.getDefaultPercentages(14)).toEqual([70, 30]);
      expect(PrizeCalculator.getDefaultPercentages(21)).toEqual([55, 28, 17]);
      expect(PrizeCalculator.getDefaultPercentages(27)).toEqual([50, 24, 16, 10]);
      expect(PrizeCalculator.getDefaultPercentages(34)).toEqual([45, 22, 15, 11, 7]);
    });

    it('固定配分がない順位数では動的配分を生成する', () => {
      const percentages = PrizeCalculator.getDefaultPercentages(40); // floor(40 * 15%) = 6
      expect(percentages).toHaveLength(6);
      expect(percentages.reduce((sum, pct) => sum + pct, 0)).toBe(100);
      expect(percentages[0]).toBeGreaterThan(percentages[5]);
    });

    it('動的配分は1位に +5pt のボーナスが乗る', () => {
      const percentages = PrizeCalculator.getDefaultPercentages(40); // 6 paid
      // 線形なら 6/21 ≒ 28.57% のところ、+5pt のバイアスで概ね 33.5% 付近に上がる。
      expect(percentages[0]).toBeGreaterThanOrEqual(33);
      expect(percentages[0]).toBeLessThan(34);
    });

    it('動的配分は順位が下がるほど同額以下になる', () => {
      const percentages = PrizeCalculator.getDefaultPercentages(100); // 15 paid

      expect(percentages).toHaveLength(15);
      for (let i = 1; i < percentages.length; i++) {
        expect(percentages[i - 1]).toBeGreaterThanOrEqual(percentages[i]);
      }
      expect(percentages.reduce((sum, pct) => sum + pct, 0)).toBeCloseTo(100, 5);
    });
  });

  describe('calculate', () => {
    it('賞金配分を正しく計算する', () => {
      const prizes = PrizeCalculator.calculate(6, 600);
      expect(prizes).toEqual([
        { position: 1, percentage: 100, amount: 600 },
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
      const prizes = PrizeCalculator.calculate(14, 101);
      const totalDistributed = prizes.reduce((sum, p) => sum + p.amount, 0);
      expect(totalDistributed).toBe(101); // 全額配分される
      // 14 entries → 2 paid → [70, 30]
      // 1位: floor(101*70/100)=70 + 余り1 = 71, 2位: floor(101*30/100)=30
      expect(prizes[0].amount).toBe(71);
      expect(prizes[1].amount).toBe(30);
    });

    it('端数がなければ全額配分される', () => {
      const prizes = PrizeCalculator.calculate(6, 600);
      const totalDistributed = prizes.reduce((sum, p) => sum + p.amount, 0);
      expect(totalDistributed).toBe(600);
    });

    it('大人数の動的配分でもプライズプールを全額配分する', () => {
      const prizes = PrizeCalculator.calculate(100, 12345);
      const totalDistributed = prizes.reduce((sum, p) => sum + p.amount, 0);

      expect(prizes).toHaveLength(15);
      expect(totalDistributed).toBe(12345);
      expect(prizes[0].amount).toBeGreaterThan(prizes[14].amount);
    });

    it('総エントリー1では優勝者が全額を受け取る', () => {
      expect(PrizeCalculator.calculate(1, 100)).toEqual([
        { position: 1, percentage: 100, amount: 100 },
      ]);
    });
  });

  describe('getPrizeForPosition', () => {
    it('入賞順位の賞金を返す', () => {
      // 14 entries → 2 paid → [70, 30]
      expect(PrizeCalculator.getPrizeForPosition(1, 14, 1400)).toBe(980);
      expect(PrizeCalculator.getPrizeForPosition(2, 14, 1400)).toBe(420);
    });

    it('入賞圏外は0を返す', () => {
      expect(PrizeCalculator.getPrizeForPosition(2, 6, 600)).toBe(0);
      expect(PrizeCalculator.getPrizeForPosition(10, 6, 600)).toBe(0);
    });

    it('動的配分の入賞最下位には賞金があり、その次は0を返す', () => {
      expect(PrizeCalculator.getPrizeForPosition(15, 100, 10000)).toBeGreaterThan(0);
      expect(PrizeCalculator.getPrizeForPosition(16, 100, 10000)).toBe(0);
    });
  });

  describe('isInTheMoney', () => {
    it('入賞圏内を正しく判定する', () => {
      expect(PrizeCalculator.isInTheMoney(1, 6)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(2, 6)).toBe(false);
      expect(PrizeCalculator.isInTheMoney(3, 6)).toBe(false);
    });

    it('人数に応じて入賞圏が変わる', () => {
      // 21人: 3位まで入賞
      expect(PrizeCalculator.isInTheMoney(3, 21)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(4, 21)).toBe(false);
    });

    it('大人数の動的入賞圏を判定できる', () => {
      expect(PrizeCalculator.isInTheMoney(15, 100)).toBe(true);
      expect(PrizeCalculator.isInTheMoney(16, 100)).toBe(false);
    });
  });
});
