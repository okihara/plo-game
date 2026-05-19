import { DEFAULT_PAYOUT_RATE, PAYOUT_STRUCTURES } from './constants.js';

export interface PrizeEntry {
  position: number;
  amount: number;
  percentage: number;
}

/**
 * 総エントリー数に応じた賞金配分を計算する
 */
export class PrizeCalculator {
  /**
   * 賞金構造を計算
   * @param totalEntries リエントリー込みの総エントリー数
   * @param prizePool 賞金プール合計
   * @param customPercentages カスタム配分（省略時はデフォルト）
   */
  static calculate(
    totalEntries: number,
    prizePool: number,
    customPercentages?: number[]
  ): PrizeEntry[] {
    const percentages = customPercentages?.length
      ? customPercentages
      : PrizeCalculator.getDefaultPercentages(totalEntries);

    const entries = percentages.map((pct, i) => ({
      position: i + 1,
      percentage: pct,
      amount: Math.floor(prizePool * pct / 100),
    }));

    // 端数の余りを1位に加算して全額配分を保証
    const totalDistributed = entries.reduce((sum, e) => sum + e.amount, 0);
    const remainder = prizePool - totalDistributed;
    if (remainder > 0 && entries.length > 0) {
      entries[0].amount += remainder;
    }

    return entries;
  }

  /**
   * 総エントリー数に基づくデフォルト配分率を取得
   */
  static getDefaultPercentages(totalEntries: number): number[] {
    const paidPlaces = PrizeCalculator.getDefaultPaidPlaces(totalEntries);
    if (paidPlaces === 0) {
      return [];
    }

    const fixedStructure = PAYOUT_STRUCTURES.find(structure => structure.paidPlaces === paidPlaces);
    return fixedStructure?.percentages ?? PrizeCalculator.generatePercentages(paidPlaces);
  }

  /**
   * リエントリーを含む総エントリー数の上位15%（切り捨て、最低1名）を入賞圏にする
   */
  static getDefaultPaidPlaces(totalEntries: number): number {
    if (totalEntries <= 0) {
      return 0;
    }
    return Math.min(totalEntries, Math.max(1, Math.floor(totalEntries * DEFAULT_PAYOUT_RATE)));
  }

  /**
   * 固定配分がない入賞順位数向けに、上位ほど厚い線形配分を生成する。
   * 線形配分のままだと優勝者の取り分が薄くなりがちなので、1 位に +5pt（500bp）の
   * ボーナスを乗せ、その分を 2 位以下から比例的に差し引いて再配分する。
   */
  private static generatePercentages(paidPlaces: number): number[] {
    const weights = Array.from({ length: paidPlaces }, (_, i) => paidPlaces - i);
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    // 線形配分を basis points で計算する。
    const rawBasisPoints = weights.map(weight => (weight * 10000) / totalWeight);

    // 1 位に +500bp、残り 9500bp の中から比例的に -500bp を差し引いて再配分する。
    const FIRST_PLACE_BONUS_BP = 500;
    const restSum = 10000 - rawBasisPoints[0];
    const biasedBasisPoints = rawBasisPoints.map((bp, i) => {
      if (i === 0) return bp + FIRST_PLACE_BONUS_BP;
      return bp - FIRST_PLACE_BONUS_BP * (bp / restSum);
    });

    // 小数2桁のパーセンテージに丸めつつ、合計が必ず100になるよう端数を最大順に+1bpする。
    const basisPoints = biasedBasisPoints.map(Math.floor);
    let remainder = 10000 - basisPoints.reduce((sum, value) => sum + value, 0);
    const fractionalOrder = biasedBasisPoints
      .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
      .sort((a, b) => b.fraction - a.fraction);

    for (let i = 0; i < fractionalOrder.length && remainder > 0; i++, remainder--) {
      basisPoints[fractionalOrder[i].index]++;
    }

    return basisPoints.map(value => value / 100);
  }

  /**
   * 指定順位の賞金額を取得
   */
  static getPrizeForPosition(
    position: number,
    totalEntries: number,
    prizePool: number,
    customPercentages?: number[]
  ): number {
    const prizes = PrizeCalculator.calculate(totalEntries, prizePool, customPercentages);
    const entry = prizes.find(p => p.position === position);
    return entry?.amount ?? 0;
  }

  /**
   * 入賞圏内かどうか
   */
  static isInTheMoney(position: number, totalEntries: number, customPercentages?: number[]): boolean {
    const percentages = customPercentages?.length
      ? customPercentages
      : PrizeCalculator.getDefaultPercentages(totalEntries);
    return position <= percentages.length;
  }
}
