import { describe, it, expect } from 'vitest';
import {
  TOURNAMENT_RANKING_POINTS,
  getTournamentRankingPoints,
} from '@plo/shared';

describe('getTournamentRankingPoints', () => {
  it('1位は最高ポイント', () => {
    expect(getTournamentRankingPoints(1)).toBe(TOURNAMENT_RANKING_POINTS[0]);
  });

  it('テーブル先頭ほどポイントが高い（単調非増加）', () => {
    for (let i = 1; i < TOURNAMENT_RANKING_POINTS.length; i++) {
      expect(TOURNAMENT_RANKING_POINTS[i]).toBeLessThanOrEqual(TOURNAMENT_RANKING_POINTS[i - 1]);
    }
  });

  it('テーブル内の各順位に対応するポイントを返す', () => {
    for (let pos = 1; pos <= TOURNAMENT_RANKING_POINTS.length; pos++) {
      expect(getTournamentRankingPoints(pos)).toBe(TOURNAMENT_RANKING_POINTS[pos - 1]);
    }
  });

  it('テーブル外の順位は0ポイント', () => {
    expect(getTournamentRankingPoints(TOURNAMENT_RANKING_POINTS.length + 1)).toBe(0);
    expect(getTournamentRankingPoints(9999)).toBe(0);
  });

  it('不正な順位は0ポイント', () => {
    expect(getTournamentRankingPoints(0)).toBe(0);
    expect(getTournamentRankingPoints(-1)).toBe(0);
    expect(getTournamentRankingPoints(NaN)).toBe(0);
    expect(getTournamentRankingPoints(Infinity)).toBe(0);
  });

  it('小数の順位は切り捨てて評価する', () => {
    expect(getTournamentRankingPoints(1.9)).toBe(TOURNAMENT_RANKING_POINTS[0]);
    expect(getTournamentRankingPoints(2.1)).toBe(TOURNAMENT_RANKING_POINTS[1]);
  });
});
