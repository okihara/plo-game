import { describe, it, expect } from 'vitest';
import { computeStats } from '../computeStats.js';

// 最小限のハンドデータを生成するヘルパー
function makeHand(overrides: {
  profit?: number;
  allInEVProfit?: number | null;
  isWinner?: boolean;
} = {}) {
  const userId = 'user1';
  const { profit = 0, allInEVProfit = null, isWinner = false } = overrides;
  return {
    id: `hand_${Math.random().toString(36).slice(2)}`,
    actions: [],
    dealerPosition: 0,
    winners: isWinner ? [userId] : ['other'],
    blinds: '1/2',
    communityCards: [],
    players: [
      { userId, seatPosition: 0, profit, allInEVProfit },
      { userId: 'user2', seatPosition: 1, profit: -profit, allInEVProfit: null },
    ],
  };
}

describe('computeStats - allInEVProfit', () => {
  const userId = 'user1';

  it('allInEVProfit がある場合、totalAllInEVProfit に反映される', () => {
    const hands = [
      makeHand({ profit: 100, allInEVProfit: 80 }),
    ];
    const stats = computeStats(hands, userId);

    expect(stats.totalProfit).toBe(100);
    expect(stats.totalAllInEVProfit).toBe(80);
  });

  it('allInEVProfit が null の場合、実利益がフォールバック', () => {
    const hands = [
      makeHand({ profit: 50, allInEVProfit: null }),
    ];
    const stats = computeStats(hands, userId);

    expect(stats.totalProfit).toBe(50);
    expect(stats.totalAllInEVProfit).toBe(50); // 実利益と同じ
  });

  it('複数ハンドで allInEVProfit が累積される', () => {
    const hands = [
      makeHand({ profit: 100, allInEVProfit: 80 }),   // EV: 80
      makeHand({ profit: -50, allInEVProfit: -30 }),   // EV: -30
      makeHand({ profit: 200, allInEVProfit: null }),   // EV: 200 (フォールバック)
    ];
    const stats = computeStats(hands, userId);

    expect(stats.totalProfit).toBe(250);           // 100 + (-50) + 200
    expect(stats.totalAllInEVProfit).toBe(250);    // 80 + (-30) + 200
  });

  it('全ハンドが非オールイン → totalAllInEVProfit = totalProfit', () => {
    const hands = [
      makeHand({ profit: 30 }),
      makeHand({ profit: -20 }),
      makeHand({ profit: 50 }),
    ];
    const stats = computeStats(hands, userId);

    expect(stats.totalAllInEVProfit).toBe(stats.totalProfit);
    expect(stats.totalAllInEVProfit).toBe(60);
  });

  it('allInEVProfit と実利益が大きく乖離するケース', () => {
    // 実際に大勝ちしたが EV 的にはマイナス（サックアウト）
    const hands = [
      makeHand({ profit: 500, allInEVProfit: -100 }),
    ];
    const stats = computeStats(hands, userId);

    expect(stats.totalProfit).toBe(500);
    expect(stats.totalAllInEVProfit).toBe(-100);
  });
});
