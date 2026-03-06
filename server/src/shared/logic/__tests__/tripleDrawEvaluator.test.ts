import { describe, it, expect } from 'vitest';
import { evaluate27LowHand, compare27LowHands } from '@plo/shared';
import type { Card } from '@plo/shared';

function c(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('evaluate27LowHand', () => {
  // === ベストハンド ===

  it('2-3-4-5-7 オフスート = Number One (rank=1, ベストハンド)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('7','h')]);
    expect(hand.rank).toBe(1);
    expect(hand.highCards).toEqual([7, 5, 4, 3, 2]);
    expect(hand.name).toBe('Number One');
  });

  it('2-3-4-6-7 = 7-6 low (rank=1)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('6','s'), c('7','h')]);
    expect(hand.rank).toBe(1);
    expect(hand.highCards).toEqual([7, 6, 4, 3, 2]);
    expect(hand.name).toBe('7-6 low');
  });

  it('2-3-4-5-8 = 8-5 low (rank=1)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('8','h')]);
    expect(hand.rank).toBe(1);
    expect(hand.highCards).toEqual([8, 5, 4, 3, 2]);
  });

  // === Ace はハイ ===

  it('Ace は14として扱われる（ハイカード、Aceハイ）', () => {
    const hand = evaluate27LowHand([c('A','h'), c('2','d'), c('3','c'), c('4','s'), c('6','h')]);
    expect(hand.rank).toBe(1); // ハイカード
    expect(hand.highCards).toEqual([14, 6, 4, 3, 2]);
  });

  it('A-2-3-4-5 はストレートではない（Ace=14で不連続）', () => {
    const hand = evaluate27LowHand([c('A','h'), c('2','d'), c('3','c'), c('4','s'), c('5','h')]);
    expect(hand.rank).toBe(1); // ハイカード（ストレートではない）
    expect(hand.highCards).toEqual([14, 5, 4, 3, 2]);
  });

  // === ストレート ===

  it('2-3-4-5-6 はストレート (rank=5)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('6','h')]);
    expect(hand.rank).toBe(5);
    expect(hand.highCards).toEqual([6]);
  });

  it('T-J-Q-K-A はストレート (rank=5)', () => {
    const hand = evaluate27LowHand([c('T','h'), c('J','d'), c('Q','c'), c('K','s'), c('A','h')]);
    expect(hand.rank).toBe(5);
    expect(hand.highCards).toEqual([14]);
  });

  it('5-6-7-8-9 はストレート (rank=5)', () => {
    const hand = evaluate27LowHand([c('5','h'), c('6','d'), c('7','c'), c('8','s'), c('9','h')]);
    expect(hand.rank).toBe(5);
    expect(hand.highCards).toEqual([9]);
  });

  // === フラッシュ ===

  it('同スート5枚はフラッシュ (rank=6)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('4','h'), c('6','h'), c('8','h'), c('T','h')]);
    expect(hand.rank).toBe(6);
    expect(hand.highCards).toEqual([10, 8, 6, 4, 2]);
  });

  it('2-3-4-5-7 同スートはフラッシュ（Number Oneにならない）', () => {
    const hand = evaluate27LowHand([c('2','h'), c('3','h'), c('4','h'), c('5','h'), c('7','h')]);
    expect(hand.rank).toBe(6); // フラッシュ
  });

  // === ストレートフラッシュ ===

  it('同スート連続はストレートフラッシュ (rank=9)', () => {
    const hand = evaluate27LowHand([c('3','d'), c('4','d'), c('5','d'), c('6','d'), c('7','d')]);
    expect(hand.rank).toBe(9);
  });

  // === ペア系 ===

  it('ワンペア (rank=2)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('2','d'), c('4','c'), c('5','s'), c('7','h')]);
    expect(hand.rank).toBe(2);
    expect(hand.highCards[0]).toBe(2); // ペアランク
  });

  it('ツーペア (rank=3)', () => {
    const hand = evaluate27LowHand([c('2','h'), c('2','d'), c('5','c'), c('5','s'), c('7','h')]);
    expect(hand.rank).toBe(3);
  });

  it('スリーカード (rank=4)', () => {
    const hand = evaluate27LowHand([c('3','h'), c('3','d'), c('3','c'), c('5','s'), c('7','h')]);
    expect(hand.rank).toBe(4);
  });

  it('フルハウス (rank=7)', () => {
    const hand = evaluate27LowHand([c('3','h'), c('3','d'), c('3','c'), c('5','s'), c('5','h')]);
    expect(hand.rank).toBe(7);
  });

  it('フォーカード (rank=8)', () => {
    const hand = evaluate27LowHand([c('3','h'), c('3','d'), c('3','c'), c('3','s'), c('7','h')]);
    expect(hand.rank).toBe(8);
  });

  // === バリデーション ===

  it('5枚以外はエラー', () => {
    expect(() => evaluate27LowHand([c('2','h'), c('3','d'), c('4','c')])).toThrow();
  });
});

describe('compare27LowHands', () => {
  it('Number One (7-5) が 8-5 low に勝つ', () => {
    const a = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('7','h')]);
    const b = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('8','d')]);
    expect(compare27LowHands(a, b)).toBeLessThan(0);
  });

  it('7-6 low が 7-5 low に負ける', () => {
    const a = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('6','s'), c('7','h')]);
    const b = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('7','d')]);
    expect(compare27LowHands(a, b)).toBeGreaterThan(0);
  });

  it('同rank内: 3番目のカードで比較', () => {
    // 8-7-5-3-2 vs 8-7-4-3-2 → 後者が良い (5 > 4)
    const a = evaluate27LowHand([c('2','h'), c('3','d'), c('5','c'), c('7','s'), c('8','h')]);
    const b = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('7','s'), c('8','d')]);
    expect(compare27LowHands(a, b)).toBeGreaterThan(0);
  });

  it('ハイカードがペアに勝つ', () => {
    const highCard = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('K','h')]);
    const pair = evaluate27LowHand([c('2','h'), c('2','d'), c('4','c'), c('5','s'), c('7','d')]);
    expect(compare27LowHands(highCard, pair)).toBeLessThan(0);
  });

  it('ペアがストレートに勝つ', () => {
    const pair = evaluate27LowHand([c('2','h'), c('2','d'), c('4','c'), c('5','s'), c('7','h')]);
    const straight = evaluate27LowHand([c('3','h'), c('4','d'), c('5','c'), c('6','s'), c('7','d')]);
    expect(compare27LowHands(pair, straight)).toBeLessThan(0);
  });

  it('同一ハンドは引き分け (0)', () => {
    const a = evaluate27LowHand([c('2','h'), c('3','d'), c('4','c'), c('5','s'), c('7','h')]);
    const b = evaluate27LowHand([c('2','d'), c('3','c'), c('4','s'), c('5','h'), c('7','d')]);
    expect(compare27LowHands(a, b)).toBe(0);
  });

  it('低いペアが高いペアに勝つ', () => {
    const pairOf2 = evaluate27LowHand([c('2','h'), c('2','d'), c('4','c'), c('5','s'), c('7','h')]);
    const pairOf3 = evaluate27LowHand([c('3','h'), c('3','d'), c('4','c'), c('5','s'), c('7','d')]);
    expect(compare27LowHands(pairOf2, pairOf3)).toBeLessThan(0);
  });

  it('ストレートがフラッシュに勝つ', () => {
    const straight = evaluate27LowHand([c('3','h'), c('4','d'), c('5','c'), c('6','s'), c('7','h')]);
    const flush = evaluate27LowHand([c('2','h'), c('4','h'), c('6','h'), c('8','h'), c('T','h')]);
    expect(compare27LowHands(straight, flush)).toBeLessThan(0);
  });
});
