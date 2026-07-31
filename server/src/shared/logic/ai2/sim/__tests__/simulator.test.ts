import { describe, it, expect } from 'vitest';
import { runMatch } from '../simulator.js';
import { createBotAgent } from '../botAgent.js';
import { ALL_EXPLOITERS } from '../exploiters.js';

describe('simulator', () => {
  // CI ランナーは遅いことがあるためタイムアウトを明示的に広げる
  it('Bot 6 体で 100 ハンド完走し、損益の合計が 0 になる', () => {
    const agents = ['A', 'B', 'C', 'D', 'E', 'F'].map(n => createBotAgent(`SimBot_${n}`));
    const result = runMatch({ agents, hands: 100 });
    expect(result.hands).toBe(100);
    const totalProfit = result.seats.reduce((s, r) => s + r.profit, 0);
    expect(totalProfit).toBe(0);
  }, 30_000);

  it('全エクスプロイターが Bot 5 体相手に 30 ハンド完走する（不正アクションなし）', () => {
    const botNames = ['SimBot_A', 'SimBot_B', 'SimBot_C', 'SimBot_D', 'SimBot_E'];
    for (const create of ALL_EXPLOITERS) {
      const agents = [create(), ...botNames.map(createBotAgent)];
      const result = runMatch({ agents, hands: 30 });
      expect(result.invalidActionCount).toBe(0);
      expect(result.seats.reduce((s, r) => s + r.profit, 0)).toBe(0);
    }
  }, 30_000);
});
