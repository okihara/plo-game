/// <reference types="node" />
/**
 * computeBubbleFactors / computeICM の計算量実測。
 *
 * 実行: cd server && npx tsx scripts/bf-bench.ts
 */
import { computeICM, computeBubbleFactors } from '../../packages/shared/src/icm.js';

function makeStacks(n: number): number[] {
  // 適当にバラバラのスタックを作る (毎回同じ並びになるよう決定論的に)
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(1000 + ((i * 137) % 50) * 100);
  }
  return out;
}

function makePayouts(k: number): number[] {
  // 上位ほど厚い (線形ダウン)
  const out: number[] = [];
  for (let i = 0; i < k; i++) {
    out.push(1000 * (k - i));
  }
  return out;
}

function bench(fn: () => unknown, iterations: number): { perMs: number; totalMs: number } {
  // ウォームアップ
  for (let i = 0; i < 3; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const totalMs = performance.now() - start;
  return { perMs: totalMs / iterations, totalMs };
}

console.log('--- computeICM ---');
console.log('n  | K  | per-call (ms) | iters | total (ms)');
console.log('---+----+---------------+-------+-----------');
for (const n of [4, 6, 9, 12, 15, 18, 20]) {
  for (const k of [2, 3, 5, 10]) {
    if (k > n) continue;
    const stacks = makeStacks(n);
    const payouts = makePayouts(k);
    const iters = n <= 10 ? 1000 : n <= 15 ? 100 : 10;
    const { perMs, totalMs } = bench(() => computeICM(stacks, payouts), iters);
    console.log(
      `${String(n).padStart(2)} | ${String(k).padStart(2)} | ${perMs.toFixed(4).padStart(13)} | ${String(iters).padStart(5)} | ${totalMs.toFixed(1).padStart(9)}`
    );
  }
}

console.log('\n--- computeBubbleFactors ---');
console.log('n  | K  | per-call (ms) | iters | total (ms)');
console.log('---+----+---------------+-------+-----------');
for (const n of [4, 6, 9, 12, 15, 18, 20]) {
  for (const k of [2, 3, 5, 10]) {
    if (k > n) continue;
    const stacks = makeStacks(n);
    const payouts = makePayouts(k);
    const iters = n <= 10 ? 1000 : n <= 15 ? 100 : 10;
    const { perMs, totalMs } = bench(() => computeBubbleFactors(stacks, payouts), iters);
    console.log(
      `${String(n).padStart(2)} | ${String(k).padStart(2)} | ${perMs.toFixed(4).padStart(13)} | ${String(iters).padStart(5)} | ${totalMs.toFixed(1).padStart(9)}`
    );
  }
}
