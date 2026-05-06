// resolveHiLoShowdown のスプリット分配テスト
// scoop / split / quartered / 同率 lo / 端数 / サイドポット 等を網羅

import { describe, it, expect } from 'vitest';
import { resolveHiLoShowdown, HiLoHand } from '../hiLoSplitPot.js';
import type { ShowdownPlayer, ShowdownPot } from '../studVariantRules.js';
import type { HandRank } from '../types.js';

// テスト用の HiLoHand 構築ヘルパー
const hi = (rank: number, highCards: number[] = [], name = 'hi'): HandRank => ({
  rank, name, highCards,
});
const lo = (highCards: number[], name?: string): HandRank => ({
  rank: 1, name: name ?? `${highCards[0]}-low`, highCards,
});

// ID → HiLoHand のマップから evalFn を作る
function evalFnFromMap(map: Record<number, HiLoHand>): (p: ShowdownPlayer) => HiLoHand {
  return (p) => map[p.id];
}

const players = (ids: number[]): ShowdownPlayer[] =>
  ids.map(id => ({ id, holeCards: [] }));

const singlePot = (amount: number, eligible: number[]): ShowdownPot[] =>
  [{ amount, eligiblePlayers: eligible }];

describe('resolveHiLoShowdown: 基本パターン', () => {
  it('scoop: 同一プレイヤーが hi と lo を両取り → 全額 + hiLoType=scoop', () => {
    // P0: nut hi + nut lo, P1: 弱 hi 弱 lo
    const map: Record<number, HiLoHand> = {
      0: { high: hi(8, [14]), low: lo([5, 4, 3, 2, 1], 'Wheel') },
      1: { high: hi(2, [10]), low: lo([8, 7, 6, 5, 1]) },
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1000, [0, 1]), evalFnFromMap(map));
    expect(winners).toHaveLength(1);
    expect(winners[0].playerId).toBe(0);
    expect(winners[0].amount).toBe(1000);
    expect(winners[0].hiLoType).toBe('scoop');
  });

  it('split: P0 が hi、P1 が lo → 半分ずつ (端数なし)', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },                 // hi 強い、lo なし
      1: { high: hi(2, [10]), low: lo([5, 4, 3, 2, 1]) },  // lo nut
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1000, [0, 1]), evalFnFromMap(map));
    expect(winners).toHaveLength(2);
    const w0 = winners.find(w => w.playerId === 0)!;
    const w1 = winners.find(w => w.playerId === 1)!;
    expect(w0.amount).toBe(500);
    expect(w0.hiLoType).toBe('high');
    expect(w1.amount).toBe(500);
    expect(w1.hiLoType).toBe('low');
  });

  it('lo 不成立 → hi 単独勝者が全額', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },
      1: { high: hi(2, [10]), low: null },
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1000, [0, 1]), evalFnFromMap(map));
    expect(winners).toHaveLength(1);
    expect(winners[0].playerId).toBe(0);
    expect(winners[0].amount).toBe(1000);
    expect(winners[0].hiLoType).toBe('high');
  });

  it('lo 不成立 + hi タイ → タイした全員で hi を分割', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(5, [10, 9, 8, 7, 6]), low: null },
      1: { high: hi(5, [10, 9, 8, 7, 6]), low: null },
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1000, [0, 1]), evalFnFromMap(map));
    expect(winners.reduce((s, w) => s + w.amount, 0)).toBe(1000);
    // 両者 500 ずつ (端数なし)
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(500);
    expect(winners.find(w => w.playerId === 1)!.amount).toBe(500);
  });
});

describe('resolveHiLoShowdown: クォーター・1/4 パターン', () => {
  it('quartered: P0 が hi 単独勝者、P1+P2 が lo タイ → P0 が 1/2、P1/P2 が 1/4 ずつ', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },
      1: { high: hi(2, [10]), low: lo([5, 4, 3, 2, 1]) },
      2: { high: hi(2, [9]),  low: lo([5, 4, 3, 2, 1]) },
    };
    const winners = resolveHiLoShowdown(players([0, 1, 2]), singlePot(1000, [0, 1, 2]), evalFnFromMap(map));
    const w0 = winners.find(w => w.playerId === 0)!;
    const w1 = winners.find(w => w.playerId === 1)!;
    const w2 = winners.find(w => w.playerId === 2)!;
    expect(w0.amount).toBe(500);
    expect(w0.hiLoType).toBe('high');
    expect(w1.amount).toBe(250);
    expect(w1.hiLoType).toBe('low');
    expect(w2.amount).toBe(250);
    expect(w2.hiLoType).toBe('low');
    expect(winners.reduce((s, w) => s + w.amount, 0)).toBe(1000);
  });

  it('hi タイ + lo 単独 → hi 半分を 2 人で割り、lo 半分は 1 人取り', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(5, [10, 9, 8, 7, 6]), low: null },                 // hi 同率、lo なし
      1: { high: hi(5, [10, 9, 8, 7, 6]), low: null },                 // hi 同率、lo なし
      2: { high: hi(2, [10]),             low: lo([5, 4, 3, 2, 1]) },  // hi 弱、lo nut
    };
    const winners = resolveHiLoShowdown(players([0, 1, 2]), singlePot(1000, [0, 1, 2]), evalFnFromMap(map));
    const total = winners.reduce((s, w) => s + w.amount, 0);
    expect(total).toBe(1000);
    expect(winners.find(w => w.playerId === 2)!.amount).toBe(500);
    expect(winners.find(w => w.playerId === 2)!.hiLoType).toBe('low');
    // P0 と P1 で hi 半分 (500) を分割 → 250 ずつ
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(250);
    expect(winners.find(w => w.playerId === 1)!.amount).toBe(250);
  });

  it('3 way scoop 不可（hi/lo それぞれ別人）でも全員 winner に入る', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },                 // hi 単独
      1: { high: hi(2, [10]), low: lo([5, 4, 3, 2, 1]) },  // lo 単独
      2: { high: hi(3, [11]), low: null },                 // どちらも取れず
    };
    const winners = resolveHiLoShowdown(players([0, 1, 2]), singlePot(1000, [0, 1, 2]), evalFnFromMap(map));
    expect(winners.find(w => w.playerId === 0)).toBeDefined();
    expect(winners.find(w => w.playerId === 1)).toBeDefined();
    expect(winners.find(w => w.playerId === 2)).toBeUndefined();
  });
});

describe('resolveHiLoShowdown: 端数 (奇数チップ) 処理', () => {
  it('端数あり split: 端数はハイへ (例: 1001 → hi 501, lo 500)', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },
      1: { high: hi(2, [10]), low: lo([5, 4, 3, 2, 1]) },
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1001, [0, 1]), evalFnFromMap(map));
    expect(winners.reduce((s, w) => s + w.amount, 0)).toBe(1001);
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(501); // hi 側に端数
    expect(winners.find(w => w.playerId === 1)!.amount).toBe(500);
  });

  it('hi 同率 2 人 + lo 1 人、端数あり (1001) → 端数はハイ最初の prizes', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(5, [10, 9, 8, 7, 6]), low: null },
      1: { high: hi(5, [10, 9, 8, 7, 6]), low: null },
      2: { high: hi(2, [10]),             low: lo([5, 4, 3, 2, 1]) },
    };
    const winners = resolveHiLoShowdown(players([0, 1, 2]), singlePot(1001, [0, 1, 2]), evalFnFromMap(map));
    expect(winners.reduce((s, w) => s + w.amount, 0)).toBe(1001);
    // hi half = ceil(1001/2) = 501、lo half = 500
    // hi half を 2 人で分割: floor(501/2) = 250、端数 1 は最初の人へ
    const w0 = winners.find(w => w.playerId === 0)!.amount;
    const w1 = winners.find(w => w.playerId === 1)!.amount;
    expect(w0 + w1).toBe(501);
    expect(winners.find(w => w.playerId === 2)!.amount).toBe(500);
  });
});

describe('resolveHiLoShowdown: サイドポット', () => {
  it('オールイン: メインポットとサイドポットで個別に hi/lo 解決', () => {
    // P0 オールイン (200)、P1/P2 が後ろでさらに 300 追加
    // メイン = 600 (3 人 eligible), サイド = 600 (P1/P2 のみ)
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: lo([5, 4, 3, 2, 1]) },  // scoop でも eligible はメインのみ
      1: { high: hi(3, [10]), low: null },
      2: { high: hi(2, [9]),  low: null },
    };
    const pots: ShowdownPot[] = [
      { amount: 600, eligiblePlayers: [0, 1, 2] }, // main
      { amount: 600, eligiblePlayers: [1, 2] },    // side (P0 not eligible)
    ];
    const winners = resolveHiLoShowdown(players([0, 1, 2]), pots, evalFnFromMap(map));

    // Main pot: P0 scoop → 600
    // Side pot: P1 が hi 単独勝者 (lo なし) → 600
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(600);
    expect(winners.find(w => w.playerId === 0)!.hiLoType).toBe('scoop');
    expect(winners.find(w => w.playerId === 1)!.amount).toBe(600);
    expect(winners.find(w => w.playerId === 1)!.hiLoType).toBe('high');
    expect(winners.find(w => w.playerId === 2)).toBeUndefined();
  });

  it('複数ポットで同一プレイヤーが両方勝った場合は合算される', () => {
    const map: Record<number, HiLoHand> = {
      0: { high: hi(7, [14]), low: null },
      1: { high: hi(3, [10]), low: null },
    };
    const pots: ShowdownPot[] = [
      { amount: 100, eligiblePlayers: [0, 1] },
      { amount: 200, eligiblePlayers: [0, 1] },
    ];
    const winners = resolveHiLoShowdown(players([0, 1]), pots, evalFnFromMap(map));
    // P0 が両ポット hi 取り → 100 + 200 = 300
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(300);
    expect(winners.find(w => w.playerId === 1)).toBeUndefined();
  });
});

describe('resolveHiLoShowdown: lo 同率 + hi 同率 のフルチョップ', () => {
  it('hi/lo 両方完全タイ → 2 人とも scoop 扱いで 50/50 に', () => {
    const handRank = lo([5, 4, 3, 2, 1], 'Wheel');
    const map: Record<number, HiLoHand> = {
      0: { high: hi(5, [5, 4, 3, 2, 1]), low: handRank },
      1: { high: hi(5, [5, 4, 3, 2, 1]), low: handRank },
    };
    const winners = resolveHiLoShowdown(players([0, 1]), singlePot(1000, [0, 1]), evalFnFromMap(map));
    expect(winners.reduce((s, w) => s + w.amount, 0)).toBe(1000);
    expect(winners.find(w => w.playerId === 0)!.amount).toBe(500);
    expect(winners.find(w => w.playerId === 1)!.amount).toBe(500);
    expect(winners.find(w => w.playerId === 0)!.hiLoType).toBe('scoop');
    expect(winners.find(w => w.playerId === 1)!.hiLoType).toBe('scoop');
  });
});
