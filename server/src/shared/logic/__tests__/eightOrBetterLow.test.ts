// 8-or-better low (Omaha Hi-Lo / Stud Hi-Lo の lo 成立条件) のテスト
// 標準ルール: 5 枚すべて 8 以下 かつ 5 ランクすべて異なる（ペア不可）

import { describe, it, expect } from 'vitest';
import { evaluate8OrBetterLow, evaluateOmahaHiLoHand, compareLowHands } from '../handEvaluator.js';
import type { Card, HandRank } from '../types.js';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

// テスト用ヘルパー: ランクをパースして 5 枚カードを作る (suit はダミー)
// 例: "A2345" → A2345 全部スペード
function hand(ranks: string): Card[] {
  return ranks.split('').map((r, i) => c(r as Card['rank'], (['s', 'h', 'c', 'd', 's'] as const)[i]));
}

function expectQualified(cards: Card[]): HandRank {
  const lo = evaluate8OrBetterLow(cards);
  expect(lo).not.toBeNull();
  return lo!;
}

describe('evaluate8OrBetterLow: ロー成立条件 (5 枚プール)', () => {
  it('A-2-3-4-5 (wheel) → 成立', () => {
    expect(evaluate8OrBetterLow(hand('A2345'))).not.toBeNull();
  });

  it('8-7-5-3-A → 成立', () => {
    expect(evaluate8OrBetterLow(hand('8753A'))).not.toBeNull();
  });

  it('8-7-6-5-4 (8-high のうち最弱の qualifying low) → 成立', () => {
    expect(evaluate8OrBetterLow(hand('87654'))).not.toBeNull();
  });

  it('1 枚でも 9 以上を含む → 不成立', () => {
    expect(evaluate8OrBetterLow(hand('92345'))).toBeNull();
  });

  it('T を含む → 不成立', () => {
    expect(evaluate8OrBetterLow(hand('T2345'))).toBeNull();
  });

  it('K を含む → 不成立', () => {
    expect(evaluate8OrBetterLow(hand('K2345'))).toBeNull();
  });

  it('1 ペア (5,5,4,2,A) → 不成立', () => {
    const cards = [c('5', 'h'), c('5', 's'), c('4', 'c'), c('2', 'd'), c('A', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('2 ペア (A,A,5,5,4) → 不成立', () => {
    const cards = [c('A', 'h'), c('A', 's'), c('5', 'c'), c('5', 'd'), c('4', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('スリーカード (A,A,A,5,4) → 不成立', () => {
    const cards = [c('A', 'h'), c('A', 's'), c('A', 'd'), c('5', 'c'), c('4', 's')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('5 枚未満 → 不成立 (null)', () => {
    expect(evaluate8OrBetterLow(hand('A234'))).toBeNull();
    expect(evaluate8OrBetterLow([])).toBeNull();
  });

  it('A は low (1) として扱われる', () => {
    // A2345 は wheel として成立するので A は 1 として機能している
    const lo = expectQualified(hand('A2345'));
    expect(lo.name).toBe('Wheel');
  });

  it('ストレート/フラッシュは lo では無視される: A-2-3-4-5 同色も普通の wheel', () => {
    const cards = [c('A', 's'), c('2', 's'), c('3', 's'), c('4', 's'), c('5', 's')];
    const lo = expectQualified(cards);
    // ストレートフラッシュではなく Wheel として成立
    expect(lo.name).toBe('Wheel');
  });
});

describe('evaluate8OrBetterLow: 6/7 枚プール (Stud 用)', () => {
  it('6 枚から best 5 unique low を選ぶ', () => {
    // 8 7 6 5 4 3 → best lo は 6-5-4-3-A? いや、A はないので best は 6-5-4-3-?
    // 8,7,6,5,4,3 → 5 unique 取って一番低いのは 6-5-4-3 + 7 = 7-6-5-4-3 = 7-low
    const cards = [c('8', 's'), c('7', 'h'), c('6', 'c'), c('5', 'd'), c('4', 's'), c('3', 'h')];
    const lo = expectQualified(cards);
    // 6 unique のうち lowest 5 を選ぶので 7-6-5-4-3 が選ばれる (8 を除外)
    expect(lo.name).toBe('7-low');
  });

  it('7 枚から best 5 unique low を選ぶ', () => {
    // A 2 3 5 8 + ペア (5) + 9 → best は A-2-3-5-8 (8-low) but 5-low (wheel) ない
    // A 2 3 5 8 → 5 unique → 8-5-3-2-A = 8-low
    const cards = [c('A', 's'), c('2', 'h'), c('3', 'c'), c('5', 'd'), c('5', 's'), c('8', 'h'), c('9', 'c')];
    const lo = expectQualified(cards);
    // A,2,3,5,8 で 8-low（9 は除外、ペアの 5 は片方のみ使用）
    expect(lo.highCards).toEqual([8, 5, 3, 2, 1]);
  });

  it('6 枚すべて 8 以下だが unique は 4 種類のみ → 不成立', () => {
    // 例: 5,5,4,4,3,3 → unique 3 種類 → 5 unique 取れない
    const cards = [c('5', 'h'), c('5', 's'), c('4', 'c'), c('4', 'd'), c('3', 's'), c('3', 'h')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('7 枚プールでも qualifying low が組めなければ null', () => {
    // 8,8,7,T,J,Q,K → unique 8以下は 8,7 の 2 種類だけ
    const cards = [c('8', 'h'), c('8', 's'), c('7', 'c'), c('T', 'd'), c('J', 's'), c('Q', 'h'), c('K', 'c')];
    expect(evaluate8OrBetterLow(cards)).toBeNull();
  });

  it('7 枚プールから wheel が組めるなら wheel が選ばれる', () => {
    const cards = [c('A', 's'), c('2', 'h'), c('3', 'c'), c('4', 'd'), c('5', 's'), c('K', 'h'), c('Q', 'c')];
    const lo = expectQualified(cards);
    expect(lo.name).toBe('Wheel');
  });
});

describe('compareLowHands: ロー強度の比較 (低いほど強い)', () => {
  // compareLowHands(a, b) < 0 → a が強い (lower is better)
  it('Wheel (5-low) は 6-low より強い', () => {
    const wheel = expectQualified(hand('A2345'));
    const sixLow = expectQualified(hand('A2346'));
    expect(compareLowHands(wheel, sixLow)).toBeLessThan(0);
  });

  it('6-low は 7-low より強い', () => {
    const sixLow = expectQualified(hand('A2346'));
    const sevenLow = expectQualified(hand('A2347'));
    expect(compareLowHands(sixLow, sevenLow)).toBeLessThan(0);
  });

  it('7-5 low は 7-6 low より強い (7 同じなら次のランクで比較)', () => {
    const sevenFive = expectQualified(hand('75432')); // 7-5-4-3-2
    const sevenSix = expectQualified(hand('76432'));  // 7-6-4-3-2
    expect(compareLowHands(sevenFive, sevenSix)).toBeLessThan(0);
  });

  it('8-7-6-5-4 (8-high) は 8-7-6-5-3 より弱い', () => {
    const eightFour = expectQualified(hand('87654'));
    const eightThree = expectQualified(hand('87653'));
    expect(compareLowHands(eightThree, eightFour)).toBeLessThan(0);
  });

  it('完全に同じ low → 同値 (タイ)', () => {
    const a = [c('A', 's'), c('2', 'h'), c('3', 'c'), c('4', 'd'), c('5', 's')];
    const b = [c('A', 'd'), c('2', 'c'), c('3', 'h'), c('4', 's'), c('5', 'd')];
    expect(compareLowHands(expectQualified(a), expectQualified(b))).toBe(0);
  });

  it('A を含む low は A-high low より強い (A は 1 扱い)', () => {
    // A-2-3-4-6 (6-high low) vs 6-5-4-3-2 (6-high low without A)
    // 両者 6-high だが、A=1 を含む方が「次に低いカード」で比較すると勝つ
    const withA = expectQualified(hand('A2346')); // 6-4-3-2-A (A=1)
    const without = expectQualified(hand('65432')); // 6-5-4-3-2
    expect(compareLowHands(withA, without)).toBeLessThan(0);
  });
});

describe('evaluateOmahaHiLoHand: ホール 2 + ボード 3 ルールでの lo 成立', () => {
  it('idguvy 再現: ボード TT55A、誰も lo 成立しない (ボード上 lo ランク 2 種類のみ)', () => {
    const board = [c('T', 'h'), c('5', 'h'), c('A', 'd'), c('T', 'd'), c('5', 's')];
    const r = evaluateOmahaHiLoHand([c('8', 's'), c('4', 'd'), c('6', 's'), c('Q', 's')], board);
    expect(r.low).toBeNull();
  });

  it('ホイールで scoop: hole A-3, board 2-4-5-K-Q → wheel straight (hi) + nut low', () => {
    const board = [c('2', 's'), c('4', 'h'), c('5', 'c'), c('K', 'd'), c('Q', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('3', 's'), c('9', 'd'), c('T', 'c')],
      board,
    );
    // Hi: A-2-3-4-5 = wheel ストレート (rank 5)
    expect(r.high.rank).toBe(5);
    // Lo: nut low (wheel)
    expect(r.low).not.toBeNull();
    expect(r.low!.name).toBe('Wheel');
  });

  it('ホールに lo 1 枚 + ボードに lo 4 枚 → 不成立 (hole から 2 必要)', () => {
    const board = [c('2', 's'), c('3', 'h'), c('5', 'c'), c('7', 'd'), c('K', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('Q', 's'), c('J', 'd'), c('T', 'c')], // lo は A だけ
      board,
    );
    expect(r.low).toBeNull();
  });

  it('ホールに lo 4 枚 + ボードに lo 2 枚しか出ない → 不成立 (board から 3 必要)', () => {
    const board = [c('2', 's'), c('3', 'h'), c('K', 'c'), c('Q', 'd'), c('J', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('4', 's'), c('5', 'd'), c('6', 'c')],
      board,
    );
    expect(r.low).toBeNull();
  });

  it('ボードに lo 3 枚 + hole に lo 2 枚 → 成立', () => {
    const board = [c('2', 's'), c('3', 'h'), c('5', 'c'), c('K', 'd'), c('Q', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('A', 'h'), c('4', 's'), c('J', 'd'), c('T', 'c')],
      board,
    );
    // hole A,4 + board 2,3,5 = A-2-3-4-5 = wheel low
    expect(r.low).not.toBeNull();
    expect(r.low!.name).toBe('Wheel');
  });

  it('カウンターフェイト: hole 2-3 + board paired with 2 or 3 → ペアで lo の組み合わせが破綻', () => {
    // ボード 2-3-7-K-Q + hole 2-3-X-Y → 2 か 3 がペアになり、その 2 枚を hole から使うと
    // ボードの 2/3 と被ってペアになり lo qualify しない可能性
    // 実際: hole 2♥3♥ + board 2♠3♠7♣ = {2,2,3,3,7} ペアあり → 不成立
    // しかし board の他の lo (5,4 など) があれば回避できる場合もある
    const board = [c('2', 's'), c('3', 's'), c('7', 'c'), c('K', 'd'), c('Q', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('2', 'h'), c('3', 'h'), c('J', 'd'), c('T', 'c')],
      board,
    );
    // hole から 2 枚選んで board 3 枚と組合せた時、unique 5 lo が組めない
    // 例: 2♥3♥ + 2♠3♠7♣ = ペアあり、2♥J + ... = J 入る、… いずれも qualify しない
    expect(r.low).toBeNull();
  });

  it('hi/lo で別々のホールカード使用 (ハイは AA、ローは A-3)', () => {
    // hole A♣ A♥ 3♠ K♦ + board 2-4-5-Q-J
    // Hi: A♣A♥ + Q-J-? = pair AA with high kickers
    // Lo: A♣-3♠ (or A♥-3♠) + 2-4-5 = A-2-3-4-5 = wheel
    const board = [c('2', 's'), c('4', 'h'), c('5', 'c'), c('Q', 'd'), c('J', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('A', 'c'), c('A', 'h'), c('3', 's'), c('K', 'd')],
      board,
    );
    expect(r.low).not.toBeNull();
    expect(r.low!.name).toBe('Wheel');
  });

  it('8-low ぴったり (8 高 low) は qualify する', () => {
    const board = [c('2', 's'), c('5', 'h'), c('7', 'c'), c('K', 'd'), c('Q', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('8', 'h'), c('A', 's'), c('J', 'd'), c('T', 'c')],
      board,
    );
    // hole 8,A + board 2,5,7 = 8-7-5-2-A = 8-low
    expect(r.low).not.toBeNull();
    expect(r.low!.highCards).toEqual([8, 7, 5, 2, 1]);
  });

  it('9 を含む組合せは qualify しない (board lo 3 枚あっても hole が 9 と A だけなら)', () => {
    const board = [c('2', 's'), c('3', 'h'), c('5', 'c'), c('K', 'd'), c('Q', 'c')];
    const r = evaluateOmahaHiLoHand(
      [c('9', 'h'), c('A', 's'), c('J', 'd'), c('T', 'c')],
      board,
    );
    // hole から 2 枚 lo 必要 → A しか lo がない → qualify しない
    expect(r.low).toBeNull();
  });
});
