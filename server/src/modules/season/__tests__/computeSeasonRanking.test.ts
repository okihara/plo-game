import { describe, it, expect } from 'vitest';
import { assignPositions, takeTop } from '../computeSeasonRanking.js';

const rows = (rps: number[]) => rps.map((totalRp, i) => ({ id: i + 1, totalRp }));

describe('assignPositions', () => {
  it('同RPは同順位で、次の順位は人数分飛ぶ', () => {
    expect(assignPositions(rows([100, 90, 90, 80])).map((r) => r.position)).toEqual([1, 2, 2, 4]);
    expect(assignPositions(rows([50, 50, 50])).map((r) => r.position)).toEqual([1, 1, 1]);
  });

  it('並び順はそのまま保つ', () => {
    expect(assignPositions(rows([100, 90, 90, 80])).map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });

  it('空配列は空', () => {
    expect(assignPositions([])).toEqual([]);
  });
});

describe('takeTop', () => {
  it('N位に並んだ人は全員含む', () => {
    const ranked = assignPositions(rows([100, 90, 80, 80, 80, 70]));
    expect(takeTop(ranked, 3).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
    expect(takeTop(ranked, 2).map((r) => r.id)).toEqual([1, 2]);
  });
});
