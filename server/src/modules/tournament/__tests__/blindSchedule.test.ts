import { describe, it, expect } from 'vitest';
import { resolveBlindSchedule } from '../constants';

describe('resolveBlindSchedule', () => {
  it('NL 2-7 Single Draw は各レベルで ante = bigBlind（BBアンティ）', () => {
    const schedule = resolveBlindSchedule('regular', 'no_limit_2-7_single_draw');
    expect(schedule.length).toBeGreaterThan(0);
    for (const level of schedule) {
      expect(level.ante).toBe(level.bigBlind);
    }
    // Lv1 は 100/200/ante200
    expect(schedule[0].smallBlind).toBe(100);
    expect(schedule[0].bigBlind).toBe(200);
    expect(schedule[0].ante).toBe(200);
  });

  it('PLO は ante=0（アンティ無し）', () => {
    const schedule = resolveBlindSchedule('regular', 'plo');
    for (const level of schedule) {
      expect(level.ante).toBe(0);
    }
  });

  it('Triple Draw (Fixed Limit) は ante=0（アンティ無し）', () => {
    const schedule = resolveBlindSchedule('regular', 'limit_2-7_triple_draw');
    for (const level of schedule) {
      expect(level.ante).toBe(0);
    }
  });

  it('bomb pot は sb/bb=0・ante=bigBlind（従来通り）', () => {
    const schedule = resolveBlindSchedule('regular', 'plo_double_board_bomb');
    for (const level of schedule) {
      expect(level.smallBlind).toBe(0);
      expect(level.bigBlind).toBe(0);
      expect(level.ante).toBeGreaterThan(0);
    }
  });

  it('ストラクチャ(regular/hyper)で durationMinutes が上書きされる', () => {
    const regular = resolveBlindSchedule('regular', 'no_limit_2-7_single_draw');
    const hyper = resolveBlindSchedule('hyper', 'no_limit_2-7_single_draw');
    expect(regular[0].durationMinutes).toBe(5);
    expect(hyper[0].durationMinutes).toBe(0.5);
    // アンティ方式はストラクチャに依らず維持される
    expect(hyper[0].ante).toBe(hyper[0].bigBlind);
  });
});
