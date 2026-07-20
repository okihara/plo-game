import { describe, it, expect } from 'vitest';
import { buildProfitHistoryPoints, ProfitHistoryRow } from '../profitHistory.js';

function row(profit: number, showdown = false, ev: number | null = null): ProfitHistoryRow {
  return { profit, finalHand: showdown ? 'Pair of Aces' : null, allInEVProfit: ev };
}

describe('buildProfitHistoryPoints', () => {
  it('maxPoints 以下なら全ポイントをそのまま返す', () => {
    const rows = [row(10), row(-5, true), row(20)];
    const { points, totalHands } = buildProfitHistoryPoints(rows, 0, 2000);
    expect(totalHands).toBe(3);
    expect(points).toHaveLength(3);
    expect(points[2]).toEqual({ p: 20, c: 25, s: -5, n: 30, e: 25 });
  });

  it('allInEVProfit が全て NULL のとき cacheEvDiff を比例配分する', () => {
    const rows = [row(100), row(100)];
    const { points } = buildProfitHistoryPoints(rows, 50, 2000);
    expect(points[0].e).toBe(125); // 100 + 50 * (1/2)
    expect(points[1].e).toBe(250); // 200 + 50 * (2/2)
  });

  it('allInEVProfit がある行が存在すれば cacheEvDiff 補正しない', () => {
    const rows = [row(100, false, 80), row(100)];
    const { points } = buildProfitHistoryPoints(rows, 50, 2000);
    expect(points[0].e).toBe(80);
    expect(points[1].e).toBe(180);
  });

  it('maxPoints 超過時はダウンサンプリングし最終ポイントの累積値を保持する', () => {
    const rows = Array.from({ length: 10000 }, (_, i) => row(i % 2 === 0 ? 10 : -5, i % 3 === 0));
    const full = buildProfitHistoryPoints(rows, 0, Infinity);
    const sampled = buildProfitHistoryPoints(rows, 0, 100);

    expect(sampled.totalHands).toBe(10000);
    expect(sampled.points).toHaveLength(100);
    // 最終ポイントは全ハンド反映後の累積値と一致
    const lastFull = full.points[full.points.length - 1];
    const lastSampled = sampled.points[sampled.points.length - 1];
    expect(lastSampled.c).toBe(lastFull.c);
    expect(lastSampled.s).toBe(lastFull.s);
    expect(lastSampled.n).toBe(lastFull.n);
    expect(lastSampled.e).toBe(lastFull.e);
    // p はバケット合計なので全バケットの p を足すと総収支になる
    const pSum = sampled.points.reduce((sum, pt) => sum + pt.p, 0);
    expect(pSum).toBe(lastFull.c);
  });

  it('累積値はサンプリング後も単調な部分列（元系列の値そのまま）になる', () => {
    const rows = Array.from({ length: 555 }, (_, i) => row((i * 7) % 13 - 6));
    const full = buildProfitHistoryPoints(rows, 0, Infinity);
    const sampled = buildProfitHistoryPoints(rows, 0, 50);
    const fullCs = new Set(full.points.map(pt => pt.c));
    for (const pt of sampled.points) {
      expect(fullCs.has(pt.c)).toBe(true);
    }
  });

  it('空配列は空を返す', () => {
    const { points, totalHands } = buildProfitHistoryPoints([], 100, 2000);
    expect(points).toEqual([]);
    expect(totalHands).toBe(0);
  });
});
