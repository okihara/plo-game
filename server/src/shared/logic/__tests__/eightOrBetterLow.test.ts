// 8-or-better low (Omaha Hi-Lo / Stud Hi-Lo の lo 成立条件) のテスト
// 標準ルール: 5 枚すべて 8 以下 かつ 5 ランクすべて異なる（ペア不可）

import { describe, it, expect } from 'vitest';
import { evaluate8OrBetterLow, evaluateOmahaHiLoHand } from '../handEvaluator.js';
import type { Card } from '../types.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('evaluate8OrBetterLow: ロー成立条件', () => {
  it('5 枚すべて 8 以下 + ペアなし → 成立 (wheel)', () => {
    const cards = [c('A', 's'), c('2', 'h'), c('3', 'c'), c('4', 'd'), c('5', 's')];
    const lo = evaluate8OrBetterLow(cards);
    expect(lo).not.toBeNull();
  });

  it('5 枚すべて 8 以下 + ペアなし (8-7-5-3-A) → 成立', () => {
    const cards = [c('8', 's'), c('7', 'h'), c('5', 'c'), c('3', 'd'), c('A', 's')];
    const lo = evaluate8OrBetterLow(cards);
    expect(lo).not.toBeNull();
  });

  it('1 枚でも 9 以上を含む → 不成立', () => {
    const cards = [c('9', 's'), c('2', 'h'), c('3', 'c'), c('4', 'd'), c('5', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('T を含む → 不成立', () => {
    const cards = [c('T', 's'), c('2', 'h'), c('3', 'c'), c('4', 'd'), c('5', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('全 8 以下だが 1 ペア (5,5,4,2,A) を含む → 不成立', () => {
    // 標準 PLO8 / O8 ルール: ペアありはローとして不成立
    const cards = [c('5', 'h'), c('5', 's'), c('4', 'c'), c('2', 'd'), c('A', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('全 8 以下だが 2 ペア (A,A,5,5,4) → 不成立', () => {
    const cards = [c('A', 'h'), c('A', 's'), c('5', 'c'), c('5', 'd'), c('4', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });
});

describe('evaluateOmahaHiLoHand: ボード/ホールの組み合わせで lo 成立判定', () => {
  it('idguvy 再現: ボード TT55A、誰も lo 成立しない（ボード上 lo ランク 2 種類のみ）', () => {
    // バグ再現: 修正前は seat5 (8,4,6,Q) と seat3 (3,8,J,T) が "ペアありロー" で qualify していた
    const board = [c('T', 'h'), c('5', 'h'), c('A', 'd'), c('T', 'd'), c('5', 's')];

    // seat3 kotoha_m: 3♣ 8♣ J♣ T♣ → 修正後は lo 不成立
    const seat3 = evaluateOmahaHiLoHand(
      [c('3', 'c'), c('8', 'c'), c('J', 'c'), c('T', 'c')],
      board,
    );
    expect(seat3.low).toBeNull();

    // seat4 kosuke_n: A♥ K♣ A♠ 4♠ → lo 不成立 (ペアあり)
    const seat4 = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('K', 'c'), c('A', 's'), c('4', 's')],
      board,
    );
    expect(seat4.low).toBeNull();

    // seat5 babyplo_: 8♠ 4♦ 6♠ Q♠ → lo 不成立 (ボード lo ランクが A,5 のみ)
    const seat5 = evaluateOmahaHiLoHand(
      [c('8', 's'), c('4', 'd'), c('6', 's'), c('Q', 's')],
      board,
    );
    expect(seat5.low).toBeNull();
  });

  it('正常系: ボード 2-4-6 / hole A-3 → wheel 成立', () => {
    const board = [c('2', 's'), c('4', 'h'), c('6', 'c'), c('T', 'd'), c('K', 'c')];
    const result = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('3', 's'), c('7', 's'), c('8', 'c')],
      board,
    );
    expect(result.low).not.toBeNull();
  });
});
