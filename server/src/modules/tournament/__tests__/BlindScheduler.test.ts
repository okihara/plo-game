import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlindScheduler } from '../BlindScheduler.js';
import { BlindLevel } from '../types.js';

const testSchedule: BlindLevel[] = [
  { level: 1, smallBlind: 1, bigBlind: 2, ante: 0, durationMinutes: 5 },
  { level: 2, smallBlind: 2, bigBlind: 4, ante: 0, durationMinutes: 5 },
  { level: 3, smallBlind: 3, bigBlind: 6, ante: 0, durationMinutes: 5 },
];

describe('BlindScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('空のスケジュールでエラーを投げる', () => {
    expect(() => new BlindScheduler([])).toThrow('schedule must have at least one level');
  });

  it('初期レベルを正しく返す', () => {
    const scheduler = new BlindScheduler(testSchedule);
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[0]);
    expect(scheduler.getCurrentLevelIndex()).toBe(0);
  });

  it('次のレベルを正しく返す', () => {
    const scheduler = new BlindScheduler(testSchedule);
    expect(scheduler.getNextLevel()).toEqual(testSchedule[1]);
  });

  it('経過時間でレベルアップし、コールバックが呼ばれる', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);

    // 5分経過 → tick() でレベル2検知
    vi.advanceTimersByTime(5 * 60 * 1000);
    scheduler.tick();
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[1]);
    expect(onLevelUp).toHaveBeenCalledTimes(1);
    expect(onLevelUp).toHaveBeenCalledWith(testSchedule[1], testSchedule[2]);
  });

  it('最終レベルに達しても安定して動作する', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);

    // レベル2、レベル3へ
    vi.advanceTimersByTime(5 * 60 * 1000);
    scheduler.tick(); // レベル2検知
    vi.advanceTimersByTime(5 * 60 * 1000);
    scheduler.tick(); // レベル3検知
    expect(onLevelUp).toHaveBeenCalledTimes(2);
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[2]);
    expect(scheduler.getNextLevel()).toBeNull();

    // さらに時間が経ってもコールバックは呼ばれない
    vi.advanceTimersByTime(10 * 60 * 1000);
    scheduler.tick();
    expect(onLevelUp).toHaveBeenCalledTimes(2);
  });

  it('stop 後はレベルが進まない', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);
    scheduler.stop();

    vi.advanceTimersByTime(10 * 60 * 1000);
    // stop後はstartedAtが0なので常にインデックス0
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[0]);
    expect(onLevelUp).not.toHaveBeenCalled();
  });

  it('startFrom で過去の開始時刻から正しいレベルを算出する', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    // 7分前に開始 → レベル2（5分でレベル2、残り2分）
    const startedAt = Date.now() - 7 * 60 * 1000;
    scheduler.startFrom(startedAt, onLevelUp);

    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[1]);
    expect(scheduler.getCurrentLevelIndex()).toBe(1);
  });

  it('getNextLevelAt が正しいタイムスタンプを返す', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    const startTime = Date.now();
    scheduler.start(onLevelUp);

    const nextAt = scheduler.getNextLevelAt();
    expect(nextAt).toBe(startTime + 5 * 60 * 1000);
  });
});
