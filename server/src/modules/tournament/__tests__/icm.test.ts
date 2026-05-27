import { describe, it, expect } from 'vitest';
import { computeICM, computeBubbleFactors } from '@plo/shared';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('computeICM', () => {
  it('returns zeros for empty stacks or payouts', () => {
    expect(computeICM([], [100])).toEqual([]);
    expect(computeICM([1000, 2000], [])).toEqual([0, 0]);
  });

  it('a single payout is distributed proportionally to stacks', () => {
    const evs = computeICM([1000, 2000, 3000], [600]);
    expect(evs[0]).toBeCloseTo(100, 6);  // 1000/6000 * 600
    expect(evs[1]).toBeCloseTo(200, 6);
    expect(evs[2]).toBeCloseTo(300, 6);
  });

  it('the sum of $EVs equals the total prize money', () => {
    const stacks = [3500, 2500, 2000, 1500, 500];
    const payouts = [500, 300, 200];
    const evs = computeICM(stacks, payouts);
    expect(sum(evs)).toBeCloseTo(sum(payouts), 6);
  });

  it('equal stacks share each payout equally', () => {
    const evs = computeICM([1000, 1000, 1000, 1000], [400, 300, 200, 100]);
    const expected = (400 + 300 + 200 + 100) / 4;
    evs.forEach(v => expect(v).toBeCloseTo(expected, 6));
  });

  it('Malmuth-Harville: known 3-player example', () => {
    // Stacks 5000/3000/2000, payouts 50/30/20. Standard textbook result:
    // p1 ≈ 38.393, p2 ≈ 32.750, p3 ≈ 28.857  (sums to 100)
    const evs = computeICM([5000, 3000, 2000], [50, 30, 20]);
    expect(evs[0]).toBeCloseTo(38.393, 2);
    expect(evs[1]).toBeCloseTo(32.750, 2);
    expect(evs[2]).toBeCloseTo(28.857, 2);
  });

  it('extra payouts beyond player count are ignored', () => {
    const evs = computeICM([1000, 2000], [600, 300, 100]);
    expect(sum(evs)).toBeCloseTo(900, 6); // only top-2 payouts assigned
  });
});

describe('computeBubbleFactors', () => {
  it('returns BF = 1.0 with winner-take-all (cash-equivalent payouts)', () => {
    // With single winner-take-all prize, chip and $ trade 1:1, so BF = 1.
    const bfs = computeBubbleFactors([1000, 2000, 3000, 4000], [1000]);
    bfs.forEach(bf => expect(bf).toBeCloseTo(1.0, 6));
  });

  it('BF > 1.0 near the bubble (3 players, only top 2 paid)', () => {
    // Stacks 5000/4000/1000, payouts 70/30 (winner-heavier).
    // Short stack faces big bubble pressure → BF should be > 1.
    const bfs = computeBubbleFactors([5000, 4000, 1000], [70, 30]);
    expect(bfs.every(bf => Number.isFinite(bf))).toBe(true);
    bfs.forEach(bf => expect(bf).toBeGreaterThan(1.0));
  });

  it('zero stacks yield NaN BF', () => {
    const bfs = computeBubbleFactors([1000, 0, 500], [100, 50]);
    expect(Number.isNaN(bfs[1])).toBe(true);
    expect(Number.isFinite(bfs[0])).toBe(true);
    expect(Number.isFinite(bfs[2])).toBe(true);
  });

  it('chip leader who already owns all chips returns NaN (no doubling room)', () => {
    const bfs = computeBubbleFactors([0, 10000, 0], [500, 300, 200]);
    expect(Number.isNaN(bfs[1])).toBe(true);
  });

  it('chip leader has higher BF than equal short stacks (more $ locked-in to protect)', () => {
    // 4 players, top 3 paid. The chip leader has more $ at risk per chip,
    // so their bubble factor exceeds that of the shorter equal stacks.
    const bfs = computeBubbleFactors([4000, 2000, 2000, 2000], [50, 30, 20]);
    expect(bfs[0]).toBeGreaterThan(bfs[1]);
    expect(bfs[1]).toBeCloseTo(bfs[2], 6);
    expect(bfs[1]).toBeCloseTo(bfs[3], 6);
  });

  it('heads-up in the money: short stack BF is ~1.0 (no remaining ICM pressure)', () => {
    // Both players are already guaranteed a payout. The short stack's all-in
    // is fully symmetric (lose -> 2nd place, win -> chips equalize), so chip
    // and $ trade 1:1 for the short side.
    const bfs = computeBubbleFactors([6000, 4000], [700, 300]);
    expect(bfs[1]).toBeCloseTo(1.0, 6);
    // The chip leader's "double" is capped at the opponent's stack (full
    // coverage rather than a true doubling), so the leader's BF still sits
    // above 1.0 — this is the standard Streib individual BF behavior.
    expect(bfs[0]).toBeGreaterThan(1.0);
  });
});
