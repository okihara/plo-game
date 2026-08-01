import { describe, it, expect, afterEach } from 'vitest';
import { getEngineForBot, v2Ratio } from '../engineSelector.js';

const ORIGINAL = process.env.BOT_ENGINE_V2_RATIO;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BOT_ENGINE_V2_RATIO;
  else process.env.BOT_ENGINE_V2_RATIO = ORIGINAL;
});

describe('engineSelector', () => {
  it('未設定なら比率は 1（全量 v2）', () => {
    delete process.env.BOT_ENGINE_V2_RATIO;
    expect(v2Ratio()).toBe(1);
    expect(getEngineForBot('AnyBot')).toBe('v2');
  });

  it('割当は決定的（同じ名前は常に同じエンジン）', () => {
    process.env.BOT_ENGINE_V2_RATIO = '0.5';
    for (let i = 0; i < 50; i++) {
      const name = `Bot_${i}`;
      expect(getEngineForBot(name)).toBe(getEngineForBot(name));
    }
  });

  it('比率 0 で全 v1、1 で全 v2', () => {
    process.env.BOT_ENGINE_V2_RATIO = '0';
    expect(getEngineForBot('AnyBot')).toBe('v1');
    process.env.BOT_ENGINE_V2_RATIO = '1';
    expect(getEngineForBot('AnyBot')).toBe('v2');
  });

  it('比率 1/3 でおおよそ 1/3 が v2 に割り当たる', () => {
    process.env.BOT_ENGINE_V2_RATIO = '0.333';
    let v2 = 0;
    const n = 3000;
    for (let i = 0; i < n; i++) {
      if (getEngineForBot(`SampleBot_${i}`) === 'v2') v2++;
    }
    expect(v2 / n).toBeGreaterThan(0.28);
    expect(v2 / n).toBeLessThan(0.39);
  });
});
