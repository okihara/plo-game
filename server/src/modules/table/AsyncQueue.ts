// 非同期タスクの直列実行キュー
// 全ての状態変更操作をキュー経由にすることで、レースコンディションを構造的に排除する

type QueueTask<T = void> = () => Promise<T>;

interface QueueEntry {
  task: QueueTask<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
}

export class AsyncQueue {
  private queue: QueueEntry[] = [];
  private running = false;

  /**
   * タスクをキューに追加して順次実行する。
   * タスク完了時に結果を返す Promise を返す。
   */
  async enqueue<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      if (!this.running) {
        this.processNext();
      }
    });
  }

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.running = false;
      return;
    }

    this.running = true;
    const { task, resolve, reject } = this.queue.shift()!;

    try {
      const result = await task();
      resolve(result);
    } catch (err) {
      reject(err);
    }

    // スタックオーバーフロー防止のため queueMicrotask で次タスクを処理
    queueMicrotask(() => this.processNext());
  }

  /** キュー内の待機中タスク数（実行中含む） */
  get size(): number {
    return this.queue.length + (this.running ? 1 : 0);
  }
}
