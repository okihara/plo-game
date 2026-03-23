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

  it('タイマー経過でレベルアップコールバックが呼ばれる', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);

    // 5分経過 → レベル2へ
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(onLevelUp).toHaveBeenCalledTimes(1);
    expect(onLevelUp).toHaveBeenCalledWith(testSchedule[1], testSchedule[2]);
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[1]);
  });

  it('最終レベルに達するとタイマーが停止する', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);

    // レベル2へ
    vi.advanceTimersByTime(5 * 60 * 1000);
    // レベル3へ（最終）
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(onLevelUp).toHaveBeenCalledTimes(2);
    expect(scheduler.getCurrentLevel()).toEqual(testSchedule[2]);
    expect(scheduler.getNextLevel()).toBeNull();

    // さらに時間が経ってもコールバックは呼ばれない
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(onLevelUp).toHaveBeenCalledTimes(2);
  });

  it('stop でタイマーが停止する', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);
    scheduler.stop();

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(onLevelUp).not.toHaveBeenCalled();
  });

  it('pause/resume で残り時間が正確に保持される', () => {
    const scheduler = new BlindScheduler(testSchedule);
    const onLevelUp = vi.fn();

    scheduler.start(onLevelUp);

    // 3分経過 → pause（残り2分）
    vi.advanceTimersByTime(3 * 60 * 1000);
    scheduler.pause();
    expect(onLevelUp).not.toHaveBeenCalled();

    // pauseの間は時間が進まない
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(onLevelUp).not.toHaveBeenCalled();

    // resume → 残り2分後にレベルアップ
    scheduler.resume(onLevelUp);
    vi.advanceTimersByTime(1 * 60 * 1000); // 1分 → まだ
    expect(onLevelUp).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1 * 60 * 1000); // さらに1分 → レベルアップ
    expect(onLevelUp).toHaveBeenCalledTimes(1);
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
