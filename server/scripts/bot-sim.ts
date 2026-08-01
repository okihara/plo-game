/// <reference types="node" />
/**
 * Bot AI 対エクスプロイターのオフライン対戦 (bot-redesign Phase 2)
 *
 * 各エクスプロイター 1 体 + 現行 Bot 5 体の 6-max で N ハンド回し、
 * エクスプロイターの BB/100（= Bot の被搾取額）を計測する。
 * Math.random をシード付き PRNG に差し替えるため再現可能。
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-sim.ts [--hands 20000] [--seed 1] [--engine v1|v2] [--duel]
 *
 * --engine v2 : エクスプロイターの相手を新エンジン (ai2/PLOStrategy2) にする
 * --duel      : エクスプロイター戦の代わりに 新エンジン3体 vs 旧エンジン3体 の直接対決
 */

const handsArgIdx = process.argv.indexOf('--hands');
const HANDS = handsArgIdx >= 0 ? Number(process.argv[handsArgIdx + 1]) : 20000;
const seedArgIdx = process.argv.indexOf('--seed');
const SEED = seedArgIdx >= 0 ? Number(process.argv[seedArgIdx + 1]) : 1;
const engineArgIdx = process.argv.indexOf('--engine');
const ENGINE = engineArgIdx >= 0 ? process.argv[engineArgIdx + 1] : 'v1';
const DUEL = process.argv.includes('--duel');

// シード付き PRNG (mulberry32) で Math.random を差し替え。
// デッキシャッフルも Bot の乱数判断もすべて再現可能になる。
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
Math.random = mulberry32(SEED);

// PRNG 差し替え後に import する（トップレベル import だと差し替え前に評価される）
async function main() {
  const { runMatch } = await import('../src/shared/logic/ai2/sim/simulator.js');
  const { createBotAgent, createBotAgentV2 } = await import('../src/shared/logic/ai2/sim/botAgent.js');
  const { ALL_EXPLOITERS } = await import('../src/shared/logic/ai2/sim/exploiters.js');
  const makeBot = ENGINE === 'v2' ? createBotAgentV2 : createBotAgent;

  if (DUEL) {
    // 新旧直接対決: 席を交互に配置（ポジション偏りは dealer ローテーションで均される）
    const agents = [
      createBotAgentV2('V2_A'), createBotAgent('V1_A'),
      createBotAgentV2('V2_B'), createBotAgent('V1_B'),
      createBotAgentV2('V2_C'), createBotAgent('V1_C'),
    ];
    console.log(`=== 新エンジン(v2) 3体 vs 旧エンジン(v1) 3体 (${HANDS} ハンド, seed=${SEED}) ===`);
    const result = runMatch({ agents, hands: HANDS });
    let v2Total = 0;
    for (const s of result.seats) {
      console.log(`${s.name.padEnd(8)} BB/100 = ${s.bb100.toFixed(1).padStart(8)} ± ${s.bb100SE.toFixed(1)}`);
      if (s.name.startsWith('V2')) v2Total += s.bb100;
    }
    console.log(`\nv2 側合計 BB/100: ${v2Total.toFixed(1)} (正なら新エンジンの勝ち)`);
    console.log(`不正アクション: ${result.invalidActionCount}`);
    return;
  }
  const { getPersonality, BOT_PERSONALITIES } = await import('../src/shared/logic/ai/personalities.js');

  // getPersonality は名前ハッシュで 3 種の強パーソナリティに割り当てる
  const botNames = ['SimBot_A', 'SimBot_B', 'SimBot_C', 'SimBot_D', 'SimBot_E'];
  const baseOf = (name: string): string => {
    const p = getPersonality(name);
    for (const base of ['TatsuyaN', 'YuHayashi', 'yuna0312']) {
      const b = BOT_PERSONALITIES[base];
      if (p.vpip === b.vpip && p.aggression === b.aggression && p.cbetFreq === b.cbetFreq) return base;
    }
    return '?';
  };

  console.log(`=== Bot(${ENGINE}) vs エクスプロイター (${HANDS} ハンド × ${ALL_EXPLOITERS.length} 対戦, seed=${SEED}) ===`);
  console.log(`personality 割当: ${botNames.map(n => `${n}→${baseOf(n)}`).join(', ')}`);
  console.log('');
  console.log(
    'エクスプロイター'.padEnd(14) +
    'BB/100'.padStart(10) + '±SE'.padStart(8) +
    'Bot計BB/100'.padStart(13) + '不正act'.padStart(9)
  );

  for (const create of ALL_EXPLOITERS) {
    const exploiter = create();
    const agents = [exploiter, ...botNames.map(makeBot)];
    const started = Date.now();
    const result = runMatch({ agents, hands: HANDS });
    const ex = result.seats[0];
    const botsTotal = result.seats.slice(1).reduce((s, r) => s + r.bb100, 0);
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    console.log(
      exploiter.name.padEnd(14) +
      ex.bb100.toFixed(1).padStart(10) +
      ex.bb100SE.toFixed(1).padStart(8) +
      botsTotal.toFixed(1).padStart(13) +
      String(result.invalidActionCount).padStart(9) +
      `   (${secs}s)`
    );
  }

  // 対照: Bot 6 体同士（合計は 0 になるはず。個体差 = パーソナリティ差 + 分散）
  const controlNames = ['SimBot_A', 'SimBot_B', 'SimBot_C', 'SimBot_D', 'SimBot_E', 'SimBot_F'];
  const control = runMatch({ agents: controlNames.map(makeBot), hands: HANDS });
  const spread = control.seats.map(s => s.bb100.toFixed(1)).join(' / ');
  console.log(`\n対照 (Bot 6 体): BB/100 = ${spread}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
