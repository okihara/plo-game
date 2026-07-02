import { describe, it, expect, vi, beforeEach } from 'vitest';

const findManyMock = vi.fn();

vi.mock('../../../config/database.js', () => ({
  prisma: {
    badge: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

import { groupBadgesForDisplay, resolveNameplate } from '../badgeService.js';

const at = (iso: string) => new Date(iso);
const badge = (type: string, awardedAt: string, rank: number | null = null) => ({
  type,
  rank,
  awardedAt: at(awardedAt),
});

describe('groupBadgesForDisplay', () => {
  it('ハンド数・勝利数は最高レベルのみ表示される', () => {
    const result = groupBadgesForDisplay([
      badge('hands_1000', '2026-01-01'),
      badge('hands_3000', '2026-02-01'),
      badge('wins_10', '2026-01-05'),
      badge('wins_100', '2026-03-01'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: 'hands_3000', count: 1, awardedAt: at('2026-02-01').toISOString() });
    expect(result[1]).toMatchObject({ type: 'wins_100', count: 1 });
  });

  it('バッドビート・ランキングは type ごとに回数をカウントし、awardedAt は最新', () => {
    const result = groupBadgesForDisplay([
      badge('bad_beat_fullhouse', '2026-01-01'),
      badge('bad_beat_fullhouse', '2026-01-10'),
      badge('bad_beat_fullhouse', '2026-01-20'),
      badge('weekly_rank_1', '2026-02-01'),
      badge('weekly_rank_1', '2026-02-08'),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      type: 'bad_beat_fullhouse',
      count: 3,
      awardedAt: at('2026-01-20').toISOString(),
    });
    expect(result[1]).toMatchObject({ type: 'weekly_rank_1', count: 2 });
  });

  it('シーズンランキングは type ごとに1枚、最良 rank を採用（TOP10/TOP30 のみ rank 表示）', () => {
    const result = groupBadgesForDisplay([
      badge('season1_top10', '2026-01-01', 8),
      badge('season1_top10', '2026-02-01', 5),
      badge('season1_no1', '2026-03-01', 1),
    ]);

    expect(result).toHaveLength(2);
    const top10 = result.find(b => b.type === 'season1_top10')!;
    expect(top10).toMatchObject({ count: 1, rank: 5, awardedAt: at('2026-02-01').toISOString() });
    // 絵柄に順位が入っている no1〜no3 は rank オーバーレイなし
    const no1 = result.find(b => b.type === 'season1_no1')!;
    expect(no1.rank).toBeUndefined();
  });

  it('スペシャルはレコードごとにそのまま表示される', () => {
    const result = groupBadgesForDisplay([
      badge('first_penguin', '2026-01-01'),
      badge('special_guest_ryutaro', '2026-02-01'),
    ]);
    expect(result.map(b => b.type)).toEqual(['first_penguin', 'special_guest_ryutaro']);
  });

  it('カテゴリの表示順（hands → wins → bad_beat → daily → weekly → tournament → season → special）を保つ', () => {
    const result = groupBadgesForDisplay([
      badge('special_guest_ryutaro', '2026-01-01'),
      badge('season1_no2', '2026-01-02', 2),
      badge('tournament_no1', '2026-01-03'),
      badge('weekly_rank_1', '2026-01-04'),
      badge('daily_rank_1', '2026-01-05'),
      badge('bad_beat_quads', '2026-01-06'),
      badge('wins_10', '2026-01-07'),
      badge('hands_1000', '2026-01-08'),
    ]);

    expect(result.map(b => b.category)).toEqual([
      'hands', 'wins', 'bad_beat', 'daily_rank', 'weekly_rank', 'tournament', 'season_rank', 'special',
    ]);
  });

  it('未定義 type のバッジは無視される', () => {
    const result = groupBadgesForDisplay([badge('unknown_badge', '2026-01-01')]);
    expect(result).toEqual([]);
  });
});

describe('resolveNameplate', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it('シーズンTop3 バッジがウィークリーチャンピオンより優先される', async () => {
    findManyMock.mockResolvedValue([{ type: 'weekly_rank_1' }, { type: 'season1_no2' }]);
    await expect(resolveNameplate('u1')).resolves.toBe('season_top3');
  });

  it('ウィークリーチャンピオンのみ保有なら weekly_champion', async () => {
    findManyMock.mockResolvedValue([{ type: 'weekly_rank_1' }]);
    await expect(resolveNameplate('u1')).resolves.toBe('weekly_champion');
  });

  it('対象バッジが無ければ undefined', async () => {
    findManyMock.mockResolvedValue([]);
    await expect(resolveNameplate('u1')).resolves.toBeUndefined();
  });
});
