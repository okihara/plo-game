import { describe, it, expect } from 'vitest';
import { buildDailyTournamentName, planForWeekday } from '../weeklySchedule.js';
import { jstParts, jstDate, opsDateParts } from '../../../shared/timeJst.js';

describe('planForWeekday', () => {
  it('曜日ごとのバリアントとラベルが本番実績と一致する', () => {
    expect(planForWeekday(0)).toMatchObject({ gameVariant: 'plo_double_board_bomb', nameLabel: 'DBBP' });
    expect(planForWeekday(1)).toMatchObject({ gameVariant: 'plo', nameLabel: 'Daily' });
    expect(planForWeekday(2)).toMatchObject({ gameVariant: 'plo', nameLabel: 'Daily' });
    expect(planForWeekday(3)).toMatchObject({ gameVariant: 'plo_hilo', nameLabel: 'PLO8' });
    expect(planForWeekday(4)).toMatchObject({ gameVariant: 'plo', nameLabel: 'Daily' });
    expect(planForWeekday(5)).toMatchObject({ gameVariant: 'plo', nameLabel: 'Daily' });
    expect(planForWeekday(6)).toMatchObject({ gameVariant: 'plo5', nameLabel: '5-Card' });
  });

  it('金曜のみ specialNote（Amazonギフト券）を持つ', () => {
    for (const wd of [0, 1, 2, 3, 4, 6]) {
      expect(planForWeekday(wd).specialNote).toBeUndefined();
    }
    expect(planForWeekday(5).specialNote).toContain('Amazonギフト券');
  });

  it('不正な曜日は throw する', () => {
    expect(() => planForWeekday(7)).toThrow();
  });
});

describe('buildDailyTournamentName', () => {
  it('BabyPLO <label> M/D 形式（ゼロ埋めなし）', () => {
    expect(buildDailyTournamentName(planForWeekday(3), { month: 7, day: 8 })).toBe('BabyPLO PLO8 7/8');
    expect(buildDailyTournamentName(planForWeekday(6), { month: 12, day: 25 })).toBe('BabyPLO 5-Card 12/25');
  });
});

describe('timeJst', () => {
  it('jstParts が JST の日付・曜日を返す（2026-07-04 は土曜）', () => {
    // UTC 2026-07-04T14:00Z = JST 7/4 23:00（土）
    const p = jstParts(new Date('2026-07-04T14:00:00Z'));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 4, hour: 23, weekday: 6 });
  });

  it('UTC 日付を跨いでも JST 基準で判定する', () => {
    // UTC 2026-07-04T16:30Z = JST 7/5 01:30（日）
    const p = jstParts(new Date('2026-07-04T16:30:00Z'));
    expect(p).toMatchObject({ day: 5, hour: 1, weekday: 0 });
  });

  it('jstDate は JST 指定時刻の UTC Date を返す', () => {
    expect(jstDate(2026, 7, 2, 22, 0).toISOString()).toBe('2026-07-02T13:00:00.000Z');
  });

  it('opsDateParts は深夜1時でも前日を営業日とする', () => {
    // JST 7/3 01:30 → 営業日は 7/2
    const p = opsDateParts(new Date('2026-07-02T16:30:00Z'));
    expect(p).toMatchObject({ month: 7, day: 2 });
    // JST 7/2 11:00 → そのまま 7/2
    const q = opsDateParts(new Date('2026-07-02T02:00:00Z'));
    expect(q).toMatchObject({ month: 7, day: 2 });
  });
});
