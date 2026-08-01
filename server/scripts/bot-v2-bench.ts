/// <reference types="node" />
/**
 * v2 エンジンの決定レイテンシ計測 (bot-redesign Phase 3)
 *
 * シミュレータで v2 Bot を回し、1 決定あたりの所要時間の分布を出す。
 * サンプル数は BOT_V2_MC_SAMPLES で変更して比較できる。
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-v2-bench.ts [--hands 300]
 *   BOT_V2_MC_SAMPLES=64 npx tsx scripts/bot-v2-bench.ts
 */

const handsArgIdx = process.argv.indexOf('--hands');
const HANDS = handsArgIdx >= 0 ? Number(process.argv[handsArgIdx + 1]) : 300;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(42);

async function main() {
  const { runMatch } = await import('../src/shared/logic/ai2/sim/simulator.js');
  const { createBotAgent, createBotAgentV2 } = await import('../src/shared/logic/ai2/sim/botAgent.js');
  const { GameState } = await import('../src/shared/logic/types.js') as never as { GameState: unknown };
  void GameState;

  const latencies: number[] = [];
  const wrap = (name: string) => {
    const inner = createBotAgentV2(name);
    return {
      name,
      act(state: Parameters<typeof inner.act>[0], idx: number) {
        const t0 = performance.now();
        const decision = inner.act(state, idx);
        if (state.currentStreet !== 'preflop') {
          latencies.push(performance.now() - t0);
        }
        return decision;
      },
    };
  };

  const agents = [
    wrap('V2_A'), createBotAgent('V1_A'),
    wrap('V2_B'), createBotAgent('V1_B'),
    wrap('V2_C'), createBotAgent('V1_C'),
  ];

  const t0 = performance.now();
  runMatch({ agents, hands: HANDS });
  const totalSec = (performance.now() - t0) / 1000;

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))];
  console.log(`BOT_V2_MC_SAMPLES=${process.env.BOT_V2_MC_SAMPLES ?? '(default 64)'}  hands=${HANDS}  合計 ${totalSec.toFixed(1)}s`);
  console.log(`v2 ポストフロップ決定: n=${latencies.length}`);
  console.log(`  p50=${pct(0.5).toFixed(1)}ms  p90=${pct(0.9).toFixed(1)}ms  p99=${pct(0.99).toFixed(1)}ms  max=${latencies[latencies.length - 1].toFixed(1)}ms`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
