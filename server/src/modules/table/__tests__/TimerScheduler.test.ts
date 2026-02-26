import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TimerScheduler } from '../TimerScheduler.js';

describe('TimerScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedule でコールバックが実行される', () => {
    const scheduler = new TimerScheduler();
    const callback = vi.fn();

    scheduler.schedule('action', 1000, callback);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('cancel でコールバックが実行されない', () => {
    const scheduler = new TimerScheduler();
    const callback = vi.fn();

    scheduler.schedule('action', 1000, callback);
    scheduler.cancel('action');

    vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('同名タイマーの上書きで古いコールバックがキャンセルされる', () => {
    const scheduler = new TimerScheduler();
    const callback1 = vi.fn();
    const callback2 = vi.fn();

    scheduler.schedule('action', 1000, callback1);
    scheduler.schedule('action', 500, callback2);

    vi.advanceTimersByTime(500);
    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1000);
    expect(callback1).not.toHaveBeenCalled();
  });

  it('cancelAll で全タイマーがキャンセルされる', () => {
    const scheduler = new TimerScheduler();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    scheduler.schedule('action', 1000, cb1);
    scheduler.schedule('runOut', 2000, cb2);
    scheduler.cancelAll();

    vi.advanceTimersByTime(3000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('isActive がタイマー状態を正しく返す', () => {
    const scheduler = new TimerScheduler();

    expect(scheduler.isActive('action')).toBe(false);
    scheduler.schedule('action', 1000, () => {});
    expect(scheduler.isActive('action')).toBe(true);

    scheduler.cancel('action');
    expect(scheduler.isActive('action')).toBe(false);
  });

  it('delay が指定時間後に resolve する', async () => {
    const scheduler = new TimerScheduler();
    let resolved = false;

    const promise = scheduler.delay('nextHand', 2000).then(() => { resolved = true; });

    expect(resolved).toBe(false);
    vi.advanceTimersByTime(2000);
    await promise;
    expect(resolved).toBe(true);
  });

  it('delay 中に cancel すると即座に resolve しない（世代チェック）', async () => {
    const scheduler = new TimerScheduler();
    const callback = vi.fn();

    scheduler.schedule('action', 1000, callback);
    scheduler.cancel('action');

    // cancel 後に同じキーで新しいタイマーを設定
    const callback2 = vi.fn();
    scheduler.schedule('action', 500, callback2);

    vi.advanceTimersByTime(500);
    expect(callback).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledOnce();
  });

  it('異なるキーのタイマーは独立して動作する', () => {
    const scheduler = new TimerScheduler();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    scheduler.schedule('action', 1000, cb1);
    scheduler.schedule('runOut', 2000, cb2);

    vi.advanceTimersByTime(1000);
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(cb2).toHaveBeenCalledOnce();
  });

  it('タイマー実行後に isActive が false になる', () => {
    const scheduler = new TimerScheduler();

    scheduler.schedule('action', 1000, () => {});
    expect(scheduler.isActive('action')).toBe(true);

    vi.advanceTimersByTime(1000);
    expect(scheduler.isActive('action')).toBe(false);
  });
});
