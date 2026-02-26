// 名前付きタイマーの一元管理
// ActionController / TableInstance に散在していた4種類のタイマーを統合する

export type TimerKey =
  | 'action'            // アクションタイムアウト
  | 'actionAnimation'   // アクション演出遅延
  | 'streetTransition'  // ストリート遷移遅延
  | 'runOut'            // オールイン時の段階的ボード表示
  | 'showdownReveal'    // ショーダウンカード公開遅延
  | 'handComplete'      // ハンド完了表示遅延
  | 'nextHand';         // 次ハンド開始遅延

export interface TimerSchedulerOptions {
  setTimeoutFn?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimeoutFn?: (timer: NodeJS.Timeout) => void;
}

export class TimerScheduler {
  private timers = new Map<TimerKey, NodeJS.Timeout>();
  private generations = new Map<TimerKey, number>();
  private setTimeoutFn: (cb: () => void, ms: number) => NodeJS.Timeout;
  private clearTimeoutFn: (timer: NodeJS.Timeout) => void;

  constructor(options?: TimerSchedulerOptions) {
    this.setTimeoutFn = options?.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options?.clearTimeoutFn ?? clearTimeout;
  }

  /**
   * 名前付きタイマーをスケジュールする。
   * 同名タイマーが既にあればキャンセルして上書き。
   */
  schedule(key: TimerKey, delayMs: number, callback: () => void): void {
    this.cancel(key);
    const gen = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, gen);

    const timer = this.setTimeoutFn(() => {
      if (this.generations.get(key) !== gen) return; // 古いコールバックを無視
      this.timers.delete(key);
      callback();
    }, delayMs);

    this.timers.set(key, timer);
  }

  /**
   * await 可能な遅延。cancel() で即座に resolve される。
   */
  delay(key: TimerKey, delayMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      this.schedule(key, delayMs, resolve);
    });
  }

  /** 特定タイマーをキャンセル */
  cancel(key: TimerKey): void {
    const timer = this.timers.get(key);
    if (timer) {
      this.clearTimeoutFn(timer);
      this.timers.delete(key);
    }
    // 世代をインクリメントして、既にスケジュール済みのコールバックを無効化
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  /** 全タイマーをキャンセル */
  cancelAll(): void {
    for (const [key, timer] of this.timers) {
      this.clearTimeoutFn(timer);
      this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
    }
    this.timers.clear();
  }

  /** 特定タイマーがアクティブか */
  isActive(key: TimerKey): boolean {
    return this.timers.has(key);
  }
}
