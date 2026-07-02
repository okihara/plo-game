import { describe, it, expect } from 'vitest';
import { buildStartText } from '../templates/start.js';
import { buildProgressText } from '../templates/progress.js';
import { buildRankingText, pickHighlight } from '../templates/ranking.js';
import { buildAnnounceFallbackText } from '../templates/announceFallback.js';
import { weightedTweetLength, assertTweetLength } from '../templates/tweetLength.js';
import { computeLateRegDeadline } from '../data/progressData.js';
import type { RankingDiff, RankingDiffEntry } from '../../season/computeSeasonRanking.js';
import type { AnnounceContext } from '../data/announceData.js';

// JST 22:00 開始（= UTC 13:00）
const START = new Date('2026-07-02T13:00:00Z');
const REGULAR_SCHEDULE = Array.from({ length: 35 }, (_, i) => ({
  level: i + 1,
  smallBlind: 100,
  bigBlind: 200,
  ante: 0,
  durationMinutes: 5,
}));

describe('computeLateRegDeadline', () => {
  it('regular（5分×Lv8）で 22:40 になる', () => {
    const deadline = computeLateRegDeadline(START, REGULAR_SCHEDULE, 8);
    expect(deadline.toISOString()).toBe('2026-07-02T13:40:00.000Z');
  });

  it('registrationLevels がスケジュール長を超えても壊れない', () => {
    const deadline = computeLateRegDeadline(START, REGULAR_SCHEDULE.slice(0, 3), 8);
    expect(deadline.toISOString()).toBe('2026-07-02T13:15:00.000Z');
  });
});

describe('buildStartText / buildProgressText', () => {
  it('START に締切時刻（JST）とタグが入る', () => {
    const text = buildStartText({
      tournamentName: 'BabyPLO Daily 7/2',
      lateRegDeadline: computeLateRegDeadline(START, REGULAR_SCHEDULE, 8),
    });
    expect(text).toContain('BabyPLO Daily 7/2');
    expect(text).toContain('22:40');
    expect(text).toContain('#BabyPLO');
    expect(text).toContain('https://baby-plo.app');
  });

  it('PROGRESS にエントリー数と締切が入る', () => {
    const text = buildProgressText({
      tournamentName: 'BabyPLO PLO8 7/8',
      totalEntries: 34,
      lateRegDeadline: computeLateRegDeadline(START, REGULAR_SCHEDULE, 8),
    });
    expect(text).toContain('34エントリー');
    expect(text).toContain('22:40');
  });
});

describe('tweetLength', () => {
  it('URL は 23 文字換算、全角は 2 文字換算', () => {
    expect(weightedTweetLength('https://baby-plo.app')).toBe(23);
    expect(weightedTweetLength('あ')).toBe(2);
    expect(weightedTweetLength('a')).toBe(1);
  });

  it('280 超で throw する', () => {
    expect(() => assertTweetLength('あ'.repeat(141))).toThrow(/too long/);
    expect(assertTweetLength('あ'.repeat(140))).toBeTruthy();
  });
});

function entry(overrides: Partial<RankingDiffEntry>): RankingDiffEntry {
  return {
    position: 1,
    userId: 'u1',
    name: 'player',
    totalRp: 100,
    rpGained: 0,
    entries: 10,
    wins: 1,
    itm: 5,
    best: 1,
    previousPosition: 1,
    positionDelta: 0,
    isNewToTop: false,
    ...overrides,
  };
}

function diffWith(top: RankingDiffEntry[]): RankingDiff {
  return {
    latestTournament: { id: 't1', name: 'BabyPLO Daily 7/2', completedAt: null, entries: 30 },
    totals: { currentRankedUsers: 50, previousRankedUsers: 49 },
    top,
    participants: [],
    tournamentsCounted: 12,
  };
}

describe('buildRankingText', () => {
  it('TOP3・マーカー・シーズン進捗・タグを含む（ダウンはマーカーなし）', () => {
    const diff = diffWith([
      entry({ position: 1, name: 'ゆたちん', totalRp: 120, rpGained: 10, positionDelta: 0 }),
      entry({ position: 2, userId: 'u2', name: 'IOwOI9', totalRp: 90, previousPosition: 3, positionDelta: 1, rpGained: 8 }),
      entry({ position: 3, userId: 'u3', name: 'down-san', totalRp: 80, previousPosition: 2, positionDelta: -1 }),
    ]);
    const text = buildRankingText(diff);
    expect(text).toContain('🏆 1位 ゆたちん（120RP / --）');
    expect(text).toContain('2位 IOwOI9（90RP / ↑1）');
    expect(text).toContain('3位 down-san（80RP）'); // ↓ は表記しない
    expect(text).not.toContain('↓');
    expect(text).toContain('完了トナメ 12本');
    expect(text).toContain('#BabyPLO');
  });

  it('NEW マーカー（圏外からのTOP入り）', () => {
    const diff = diffWith([
      entry({ position: 1 }),
      entry({ position: 2, userId: 'u2' }),
      entry({ position: 3, userId: 'u3', name: 'newcomer', totalRp: 70, previousPosition: null, positionDelta: null, isNewToTop: true, rpGained: 70 }),
    ]);
    expect(buildRankingText(diff)).toContain('3位 newcomer（70RP / NEW）');
  });
});

describe('pickHighlight', () => {
  it('TOP10入りを最優先で選ぶ', () => {
    const diff = diffWith([
      entry({ position: 1, rpGained: 5 }),
      entry({ position: 9, userId: 'u9', name: 'ふちがち', previousPosition: 23, positionDelta: 14, rpGained: 20, isNewToTop: false }),
    ]);
    expect(pickHighlight(diff)).toBe('ふちがち さんが 23位 → 9位 に急浮上して TOP10入り');
  });

  it('該当がなければ首位の加点コメント、それも無ければフォールバック', () => {
    expect(pickHighlight(diffWith([entry({ position: 1, name: 'leader', rpGained: 12 })])))
      .toContain('1位の leader さん');
    expect(pickHighlight(diffWith([entry({ position: 1, rpGained: 0 })])))
      .toContain('BabyPLO Daily 7/2');
  });
});

describe('buildAnnounceFallbackText', () => {
  const base: AnnounceContext = {
    today: {
      id: 't1',
      name: 'BabyPLO PLO8 7/8',
      scheduledStartTime: '2026-07-08T13:00:00.000Z',
      buyIn: 1000,
      maxPlayers: 102,
      gameVariant: 'plo_hilo',
    },
    previousResult: {
      tournament: {
        id: 't0',
        name: 'BabyPLO Daily 7/7',
        completedAt: '2026-07-07T14:30:00.000Z',
        hoursAgo: 20,
        stale: false,
        totalEntries: 31,
        uniqueRegistrations: 25,
      },
      winner: { displayName: 'ゆたちん' },
    },
  };

  it('固定の冒頭2行・昨夜の結果・種目を含む', () => {
    const text = buildAnnounceFallbackText(base);
    expect(text.startsWith('参加無料のオンラインPLOトーナメント\n今夜も22:00から開催です！')).toBe(true);
    expect(text).toContain('ゆたちん さんが 31エントリーを制して優勝🏆');
    expect(text).toContain('PLO8（Hi-Lo）');
    expect(text).toContain('#BabyPLO');
  });

  it('specialNote があれば織り込む・stale なら昨夜の結果を省く', () => {
    const withNote = buildAnnounceFallbackText(base, '優勝者にAmazonギフト券1,000円分');
    expect(withNote).toContain('Amazonギフト券');

    const stale = buildAnnounceFallbackText({
      ...base,
      previousResult: {
        ...base.previousResult!,
        tournament: { ...base.previousResult!.tournament, stale: true },
      },
    });
    expect(stale).not.toContain('優勝🏆');
  });
});
