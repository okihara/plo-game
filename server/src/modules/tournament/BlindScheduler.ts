import { BlindLevel } from './types.js';

/**
 * タイマーベースのブラインドレベル管理
 * 各レベルの durationMinutes 経過後にコールバックを発火する
 */
export class BlindScheduler {
  private schedule: BlindLevel[];
  private currentIndex: number = 0;
  private timer: NodeJS.Timeout | null = null;
  private levelStartedAt: number = 0; // ms timestamp
  private pausedRemainingMs: number = 0;
  private isPaused: boolean = false;

  constructor(schedule: BlindLevel[]) {
    if (schedule.length === 0) {
      throw new Error('BlindScheduler: schedule must have at least one level');
    }
    this.schedule = schedule;
  }

  /**
   * ブラインドスケジュールを開始
   * @param onLevelUp レベル変更時のコールバック（新レベル, 次レベル）
   */
  start(onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    this.currentIndex = 0;
    this.scheduleNext(onLevelUp);
  }

  /**
   * スケジュールを停止
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.isPaused = false;
    this.pausedRemainingMs = 0;
  }

  /**
   * 一時停止
   */
  pause(): void {
    if (this.isPaused || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.isPaused = true;
    const elapsed = Date.now() - this.levelStartedAt;
    const totalMs = this.schedule[this.currentIndex].durationMinutes * 60 * 1000;
    this.pausedRemainingMs = Math.max(0, totalMs - elapsed);
  }

  /**
   * 再開
   */
  resume(onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.levelStartedAt = Date.now() - (this.getCurrentLevelDurationMs() - this.pausedRemainingMs);

    this.timer = setTimeout(() => {
      this.advanceLevel(onLevelUp);
    }, this.pausedRemainingMs);
  }

  /**
   * 現在のブラインドレベルを取得
   */
  getCurrentLevel(): BlindLevel {
    return this.schedule[this.currentIndex];
  }

  /**
   * 次のブラインドレベルを取得（最終レベルならnull）
   */
  getNextLevel(): BlindLevel | null {
    if (this.currentIndex + 1 >= this.schedule.length) return null;
    return this.schedule[this.currentIndex + 1];
  }

  /**
   * 現在のレベルインデックスを取得
   */
  getCurrentLevelIndex(): number {
    return this.currentIndex;
  }

  /**
   * 次のレベル変更までのUNIXタイムスタンプ（ms）を取得
   */
  getNextLevelAt(): number {
    if (this.isPaused) {
      return Date.now() + this.pausedRemainingMs;
    }
    return this.levelStartedAt + this.getCurrentLevelDurationMs();
  }

  private getCurrentLevelDurationMs(): number {
    return this.schedule[this.currentIndex].durationMinutes * 60 * 1000;
  }

  private scheduleNext(onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    this.levelStartedAt = Date.now();
    const durationMs = this.getCurrentLevelDurationMs();

    this.timer = setTimeout(() => {
      this.advanceLevel(onLevelUp);
    }, durationMs);
  }

  private advanceLevel(onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    this.timer = null;

    if (this.currentIndex + 1 >= this.schedule.length) {
      // 最終レベル: 最後のブラインドで継続（タイマーは停止）
      return;
    }

    this.currentIndex++;
    const current = this.schedule[this.currentIndex];
    const next = this.getNextLevel();

    // scheduleNext を先に呼び、levelStartedAt を更新してから broadcast する
    this.scheduleNext(onLevelUp);
    onLevelUp(current, next);
  }
}
