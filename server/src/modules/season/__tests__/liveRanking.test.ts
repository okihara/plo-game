import { describe, it, expect } from 'vitest';
import { buildLiveRankingRows } from '../liveRanking.js';
import type { UserRankAgg } from '../computeSeasonRanking.js';

function user(i: number, totalRp: number): UserRankAgg {
  return {
    userId: `u${i}`,
    name: `user${i}`,
    provider: 'twitter',
    totalRp,
    entries: 1,
    wins: 0,
    itm: 1,
    best: 3,
    totalPrize: totalRp * 1000,
  };
}

// RP 降順に並んだ 10 人（u1=100RP, u2=90RP, ..., u10=10RP）
const ranking = Array.from({ length: 10 }, (_, i) => user(i + 1, 100 - i * 10));

describe('buildLiveRankingRows', () => {
  it('userId 未指定なら TOP N のみ返す', () => {
    const { top, around, me } = buildLiveRankingRows(ranking, undefined, 3, 2);
    expect(top.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(around).toEqual([]);
    expect(me).toBeNull();
  });

  it('RP 未獲得（ランキング外）なら me は null', () => {
    const { me } = buildLiveRankingRows(ranking, 'nobody', 3, 2);
    expect(me).toBeNull();
  });

  it('TOP N 圏内なら around は空で rpToTop は null', () => {
    const { around, me } = buildLiveRankingRows(ranking, 'u2', 3, 2);
    expect(around).toEqual([]);
    expect(me).toMatchObject({ position: 2, totalRp: 90, rpToNext: 10, rpToTop: null });
  });

  it('1位なら rpToNext は null', () => {
    const { me } = buildLiveRankingRows(ranking, 'u1', 3, 2);
    expect(me).toMatchObject({ position: 1, rpToNext: null, rpToTop: null });
  });

  it('圏外なら前後の順位と TOP N までの差を返す', () => {
    const { around, me } = buildLiveRankingRows(ranking, 'u7', 3, 2);
    expect(around.map((r) => r.position)).toEqual([5, 6, 7, 8, 9]);
    // 3位=80RP、自分=40RP
    expect(me).toMatchObject({ position: 7, totalRp: 40, rpToNext: 10, rpToTop: 40 });
  });

  it('around は TOP N と重複せず、末尾で切れる', () => {
    expect(buildLiveRankingRows(ranking, 'u4', 3, 2).around.map((r) => r.position)).toEqual([4, 5, 6]);
    expect(buildLiveRankingRows(ranking, 'u10', 3, 2).around.map((r) => r.position)).toEqual([8, 9, 10]);
  });

  it('best が Infinity なら null に変換する', () => {
    const { top } = buildLiveRankingRows([{ ...user(1, 5), best: Infinity }], undefined, 3, 2);
    expect(top[0].best).toBeNull();
  });
});
