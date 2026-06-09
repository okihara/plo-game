// オールインEV計算を worker_threads にオフロードするためのワーカープール。
//
// EV はハンド履歴・スタッツの「後追い更新」専用で、リアルタイムのゲーム進行には使わない。
// よって本プールは fire-and-forget 前提で、混雑時にジョブをドロップしてよい（nice-to-have）。
// メインのイベントループを塞がないことが第一目的。
import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
import type { EVJobInput } from './evWorker.js';

/** ワーカー数。2 vCPU 想定で既定 2。EV 計算は短命なので少数で足りる。 */
const WORKER_COUNT = Math.max(
  1,
  parseInt(process.env.EV_WORKER_COUNT || '', 10) || Math.min(2, Math.max(1, cpus().length - 1)),
);
/** キュー上限。これを超えたジョブはドロップ（EV なしで履歴が残るだけ）。 */
const MAX_QUEUE = Math.max(1, parseInt(process.env.EV_MAX_QUEUE || '', 10) || 200);

type EVResult = Map<number, number> | null;

interface QueuedJob {
  input: EVJobInput;
  resolve: (result: EVResult) => void;
}

interface ActiveJob {
  id: number;
  resolve: (result: EVResult) => void;
}

class EVWorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  /** worker → 実行中ジョブ。1 worker = 1 job。 */
  private active = new Map<Worker, ActiveJob>();
  private queue: QueuedJob[] = [];
  private jobIdCounter = 0;
  private droppedCount = 0;
  private started = false;

  /** EV 計算をキューに入れる。結果が出れば Map、ドロップ/失敗時は null を resolve。 */
  enqueue(input: EVJobInput): Promise<EVResult> {
    this.ensureStarted();

    if (this.queue.length >= MAX_QUEUE) {
      this.droppedCount++;
      if (this.droppedCount % 50 === 1) {
        console.warn(
          `[EVWorkerPool] queue full (${this.queue.length}), dropping EV job. total dropped=${this.droppedCount}`,
        );
      }
      return Promise.resolve(null);
    }

    return new Promise<EVResult>((resolve) => {
      this.queue.push({ input, resolve });
      this.dispatch();
    });
  }

  private ensureStarted(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < WORKER_COUNT; i++) {
      this.spawn();
    }
  }

  private spawn(): void {
    const worker = new Worker(new URL('./evWorker.boot.mjs', import.meta.url));
    // プロセス終了を worker が妨げないようにする（デーモンではない）。
    worker.unref();

    worker.on('message', (msg: { id: number; profits: [number, number][] }) => {
      const job = this.active.get(worker);
      this.active.delete(worker);
      if (job && job.id === msg.id) {
        job.resolve(msg.profits.length > 0 ? new Map(msg.profits) : new Map());
      }
      this.idle.push(worker);
      this.dispatch();
    });

    worker.on('error', (err) => {
      console.error('[EVWorkerPool] worker error, respawning:', err);
      this.replaceWorker(worker);
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[EVWorkerPool] worker exited with code ${code}, respawning`);
        this.replaceWorker(worker);
      }
    });

    this.workers.push(worker);
    this.idle.push(worker);
  }

  /** 異常終了した worker を破棄して作り直し、実行中だったジョブは null で解決する。 */
  private replaceWorker(worker: Worker): void {
    const job = this.active.get(worker);
    if (job) {
      this.active.delete(worker);
      job.resolve(null);
    }
    this.workers = this.workers.filter((w) => w !== worker);
    this.idle = this.idle.filter((w) => w !== worker);
    worker.terminate().catch(() => {});
    if (this.started) this.spawn();
  }

  private dispatch(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop()!;
      const { input, resolve } = this.queue.shift()!;
      const id = ++this.jobIdCounter;
      this.active.set(worker, { id, resolve });
      worker.postMessage({ id, input });
    }
  }
}

export const evWorkerPool = new EVWorkerPool();
