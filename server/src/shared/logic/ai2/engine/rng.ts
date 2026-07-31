// ハンド内で一貫した意思決定をするための決定的乱数。
// 「同じ状況では同じ傾向、ハンドが変われば混ざる」を実現する
// （docs/bot-redesign.md 再設計原則 4: ノードごとの独立サイコロを廃止）。

import { Card } from '../../types.js';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * ハンド固有のシードを作る。ホールカード + 席で決まるため、
 * 同一ハンド内の再訪では同じ乱数列になり、ハンドごとには変わる。
 */
export function handSeed(holeCards: Card[], playerIndex: number, salt: string): number {
  const key = holeCards.map(c => `${c.rank}${c.suit}`).join('') + `#${playerIndex}#${salt}`;
  return hashString(key);
}
