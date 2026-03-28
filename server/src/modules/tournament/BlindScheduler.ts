import { BlindLevel } from './types.js';

/**
 * 経過時間ベースのブラインドレベル管理
 * startedAt からの経過時間でレベルを算出する（タイマー不要）
 */
export class BlindScheduler {
  private schedule: BlindLevel[];
  private startedAt: number = 0; // ms timestamp (0 = 未開始)
  private lastNotifiedIndex: number = -1;
  private onLevelUp: ((current: BlindLevel, next: BlindLevel | null) => void) | null = null;

  constructor(schedule: BlindLevel[]) {
    if (schedule.length === 0) {
      throw new Error('BlindScheduler: schedule must have at least one level');
    }
    this.schedule = schedule;
  }

  /**
   * 開始時刻を設定（ブラインド計算の基準点）
   */
  start(onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    this.startedAt = Date.now();
    this.lastNotifiedIndex = 0;
    this.onLevelUp = onLevelUp;
  }

  /**
   * 特定の開始時刻からブラインドを計算する（再接続・遅れて参加時用）
   */
  startFrom(startedAt: number | Date, onLevelUp: (current: BlindLevel, next: BlindLevel | null) => void): void {
    this.startedAt = typeof startedAt === 'number' ? startedAt : startedAt.getTime();
    this.lastNotifiedIndex = this.computeCurrentIndex();
    this.onLevelUp = onLevelUp;
  }

  /**
   * スケジュールを停止
   */
  stop(): void {
    this.startedAt = 0;
    this.onLevelUp = null;
  }

  /**
   * 現在のブラインドレベルを取得（副作用なし）
   */
  getCurrentLevel(): BlindLevel {
    const idx = this.computeCurrentIndex();
    return this.schedule[idx];
  }

  /**
   * レベル変更を検知して onLevelUp を呼ぶ（明示的に呼ぶ）
   */
  tick(): void {
    const idx = this.computeCurrentIndex();
    this.checkAndNotify(idx);
  }

  /**
   * 次のブラインドレベルを取得（最終レベルならnull）
   */
  getNextLevel(): BlindLevel | null {
    const idx = this.computeCurrentIndex();
    if (idx + 1 >= this.schedule.length) return null;
    return this.schedule[idx + 1];
  }

  /**
   * 現在のレベルインデックスを取得
   */
  getCurrentLevelIndex(): number {
    return this.computeCurrentIndex();
  }

  /**
   * 次のレベル変更までのUNIXタイムスタンプ（ms）を取得
   */
  getNextLevelAt(): number {
    const idx = this.computeCurrentIndex();
    if (idx + 1 >= this.schedule.length) {
      return Date.now() + 999_999_999; // 最終レベル
    }
    return this.getLevelStartAt(idx + 1);
  }

  isStarted(): boolean {
    return this.startedAt > 0;
  }

  getStartedAt(): number {
    return this.startedAt;
  }

  // --- private ---

  /**
   * 経過時間から現在のレベルインデックスを算出
   */
  private computeCurrentIndex(): number {
    if (this.startedAt === 0) return 0;
    const elapsed = Date.now() - this.startedAt;
    let accumulated = 0;
    for (let i = 0; i < this.schedule.length; i++) {
      accumulated += this.schedule[i].durationMinutes * 60_000;
      if (elapsed < accumulated) return i;
    }
    return this.schedule.length - 1; // 最終レベルで固定
  }

  /**
   * 指定レベルの開始タイムスタンプを算出
   */
  private getLevelStartAt(levelIndex: number): number {
    let accumulated = 0;
    for (let i = 0; i < levelIndex && i < this.schedule.length; i++) {
      accumulated += this.schedule[i].durationMinutes * 60_000;
    }
    return this.startedAt + accumulated;
  }

  /**
   * レベル変更を検知して通知
   */
  private checkAndNotify(currentIndex: number): void {
    if (currentIndex > this.lastNotifiedIndex && this.onLevelUp) {
      this.lastNotifiedIndex = currentIndex;
      const current = this.schedule[currentIndex];
      const next = currentIndex + 1 < this.schedule.length ? this.schedule[currentIndex + 1] : null;
      this.onLevelUp(current, next);
    }
  }
}
