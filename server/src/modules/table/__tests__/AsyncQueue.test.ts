import { describe, it, expect } from 'vitest';
import { AsyncQueue } from '../AsyncQueue.js';

describe('AsyncQueue', () => {
  it('タスクを順次実行する', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    await Promise.all([
      queue.enqueue(async () => { order.push(1); }),
      queue.enqueue(async () => { order.push(2); }),
      queue.enqueue(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('タスクの戻り値を取得できる', async () => {
    const queue = new AsyncQueue();
    const result = await queue.enqueue(async () => 42);
    expect(result).toBe(42);
  });

  it('1つのタスクが失敗しても他のタスクは実行される', async () => {
    const queue = new AsyncQueue();
    const order: number[] = [];

    const p1 = queue.enqueue(async () => { order.push(1); });
    const p2 = queue.enqueue(async () => { throw new Error('fail'); });
    const p3 = queue.enqueue(async () => { order.push(3); });

    await p1;
    await expect(p2).rejects.toThrow('fail');
    await p3;

    expect(order).toEqual([1, 3]);
  });

  it('非同期タスクの直列化を保証する', async () => {
    const queue = new AsyncQueue();
    const order: string[] = [];

    await Promise.all([
      queue.enqueue(async () => {
        order.push('a-start');
        await new Promise(r => setTimeout(r, 50));
        order.push('a-end');
      }),
      queue.enqueue(async () => {
        order.push('b-start');
        await new Promise(r => setTimeout(r, 10));
        order.push('b-end');
      }),
    ]);

    // a が完全に終わってから b が始まる
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('size がキュー内のタスク数を返す', async () => {
    const queue = new AsyncQueue();
    expect(queue.size).toBe(0);

    let resolveTask!: () => void;
    const blockingPromise = new Promise<void>(r => { resolveTask = r; });

    const p1 = queue.enqueue(async () => { await blockingPromise; });
    // p1 が実行中なので size は 1
    expect(queue.size).toBe(1);

    const p2 = queue.enqueue(async () => {});
    // p1 実行中 + p2 待機中 = 2
    expect(queue.size).toBe(2);

    resolveTask();
    await p1;
    await p2;

    expect(queue.size).toBe(0);
  });
});
