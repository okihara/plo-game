import { PAYOUT_STRUCTURES } from './constants.js';

export interface PrizeEntry {
  position: number;
  amount: number;
  percentage: number;
}

/**
 * プレイヤー数に応じた賞金配分を計算する
 */
export class PrizeCalculator {
  /**
   * 賞金構造を計算
   * @param totalPlayers 総参加者数
   * @param prizePool 賞金プール合計
   * @param customPercentages カスタム配分（省略時はデフォルト）
   */
  static calculate(
    totalPlayers: number,
    prizePool: number,
    customPercentages?: number[]
  ): PrizeEntry[] {
    const percentages = customPercentages?.length
      ? customPercentages
      : PrizeCalculator.getDefaultPercentages(totalPlayers);

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
   * プレイヤー数に基づくデフォルト配分率を取得
   */
  static getDefaultPercentages(totalPlayers: number): number[] {
    for (const structure of PAYOUT_STRUCTURES) {
      if (totalPlayers <= structure.maxPlayers) {
        return structure.percentages;
      }
    }
    // fallback（到達しないはず）
    return PAYOUT_STRUCTURES[PAYOUT_STRUCTURES.length - 1].percentages;
  }

  /**
   * 指定順位の賞金額を取得
   */
  static getPrizeForPosition(
    position: number,
    totalPlayers: number,
    prizePool: number,
    customPercentages?: number[]
  ): number {
    const prizes = PrizeCalculator.calculate(totalPlayers, prizePool, customPercentages);
    const entry = prizes.find(p => p.position === position);
    return entry?.amount ?? 0;
  }

  /**
   * 入賞圏内かどうか
   */
  static isInTheMoney(position: number, totalPlayers: number, customPercentages?: number[]): boolean {
    const percentages = customPercentages?.length
      ? customPercentages
      : PrizeCalculator.getDefaultPercentages(totalPlayers);
    return position <= percentages.length;
  }
}
