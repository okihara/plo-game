import { describe, it, expect } from 'vitest';
import { createInitialGameState, startNewHand } from '../gameEngine.js';
import { evaluatePLOHand, evaluateCurrentHand } from '../handEvaluator.js';
import type { Card } from '../types.js';
import { evaluatePreflopPLO5 } from '../ai/preflopEvaluatorPLO5.js';

function card(rank: Card['rank'], suit: Card['suit']): Card {
  return { rank, suit };
}

describe('PLO5: gameEngine.startNewHand', () => {
  it('variant=plo5 で各プレイヤーに 5 枚のホールカードが配られる', () => {
    const state = createInitialGameState();
    state.variant = 'plo5';
    const newState = startNewHand(state);
    for (const p of newState.players) {
      if (p.isSittingOut) continue;
      expect(p.holeCards).toHaveLength(5);
    }
  });

  it('variant=plo5 で 6 人 × 5 枚 = 30 枚がデッキから配られる', () => {
    const state = createInitialGameState();
    state.variant = 'plo5';
    const newState = startNewHand(state);
    // 52 - 30 = 22 枚残り
    expect(newState.deck).toHaveLength(22);
  });

  it('variant=plo (デフォルト) は引き続き 4 枚配り (回帰チェック)', () => {
    const state = createInitialGameState();
    const newState = startNewHand(state);
    for (const p of newState.players) {
      expect(p.holeCards).toHaveLength(4);
    }
    expect(newState.deck).toHaveLength(28);
  });
});

describe('PLO5: evaluatePLOHand (5 枚ホール)', () => {
  it('5 枚ホール × 5 枚ボードでフルハウスを正しく検出する', () => {
    // ホール: AA + KKQ
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s')];
    // ボード: AcKsKd で AAA+KK のフルハウスが組める (ホール AhAd + ボード AcKsKd)
    const board = [card('A','c'), card('K','s'), card('K','d'), card('Q','h'), card('J','h')];
    const result = evaluatePLOHand(hole, board);
    // ベスト: AAA / KK のフルハウス (rank=7)
    expect(result.rank).toBeGreaterThanOrEqual(7);
  });

  it('5 枚ホールで 100 通り (C(5,2)*C(5,3)) の組合せが評価され、ベストが選ばれる', () => {
    // ホール: 4枚は弱、1枚だけが強 (Ah)
    const hole = [card('2','c'), card('3','d'), card('4','s'), card('5','h'), card('A','h')];
    // ボード: AAA でクワッズ完成 (Ah + ボード3枚のA で 4 of a kind)
    const board = [card('A','c'), card('A','d'), card('A','s'), card('7','d'), card('2','h')];
    const result = evaluatePLOHand(hole, board);
    // 必ずホール 2 枚を使うルールなので、Ah を含む 2 枚 + ボード 3 枚 = AAAA + kicker のフォーカード
    expect(result.rank).toBe(8);  // フォーカード
  });

  it('4 枚ホールで動作することを引き続き保証 (回帰チェック)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c')];
    // ボードにペアがあって AAA+KK が組めるケース
    const board = [card('A','c'), card('K','s'), card('K','d'), card('Q','h'), card('J','h')];
    const result = evaluatePLOHand(hole, board);
    expect(result.rank).toBeGreaterThanOrEqual(7);  // フルハウス以上
  });

  it('3 枚ホールはエラー', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h')];
    const board = [card('5','c'), card('5','d'), card('5','h'), card('7','d'), card('2','c')];
    expect(() => evaluatePLOHand(hole, board)).toThrow();
  });

  it('6 枚ホールはエラー', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s'), card('J','d')];
    const board = [card('5','c'), card('5','d'), card('5','h'), card('7','d'), card('2','c')];
    expect(() => evaluatePLOHand(hole, board)).toThrow();
  });
});

describe('PLO5: evaluateCurrentHand (フロップ・ターン)', () => {
  it('5 枚ホール × 3 枚ボード (フロップ) で評価できる', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','c'), card('Q','s')];
    // ボード AcKdKs: ホール AhAd + ボード3枚 で AAA+KK のフルハウス
    const board = [card('A','c'), card('K','d'), card('K','s')];
    const result = evaluateCurrentHand(hole, board);
    expect(result).not.toBeNull();
    expect(result!.rank).toBeGreaterThanOrEqual(7);
  });
});

describe('PLO5: evaluatePreflopPLO5', () => {
  it('5 枚以外は score=0 を返す', () => {
    const result = evaluatePreflopPLO5([card('A','h'), card('A','d'), card('K','h'), card('K','c')]);
    expect(result.score).toBe(0);
  });

  it('AAKKQ ds 級の強ハンドは高スコア (>= 0.6)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('Q','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.hasPair).toBe(true);
    expect(result.pairRank).toBe('A');
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('ガベージ (2c 5d 8s Jh 4c) は強ハンドより低スコア', () => {
    const garbage = evaluatePreflopPLO5([card('2','c'), card('5','d'), card('8','s'), card('J','h'), card('4','c')]);
    const premium = evaluatePreflopPLO5([card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('Q','c')]);
    expect(garbage.score).toBeLessThan(premium.score);
  });

  it('5 枚ランダウン (T9876) は isRundown=true', () => {
    const hole = [card('T','h'), card('9','d'), card('8','c'), card('7','s'), card('6','h')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.isRundown).toBe(true);
  });

  it('ダブルスーテッド (♠♠♥♥x) は isDoubleSuited=true', () => {
    const hole = [card('A','s'), card('K','s'), card('Q','h'), card('J','h'), card('5','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.isDoubleSuited).toBe(true);
  });

  it('ダングラー検出 (AAKK + 2)', () => {
    const hole = [card('A','h'), card('A','d'), card('K','h'), card('K','d'), card('2','c')];
    const result = evaluatePreflopPLO5(hole);
    expect(result.hasDangler).toBe(true);
  });

  it('スコアは 0〜1 の範囲に収まる', () => {
    const hands: Card[][] = [
      [card('A','s'), card('A','h'), card('A','d'), card('A','c'), card('K','s')],  // AAAA + K
      [card('2','c'), card('3','d'), card('4','s'), card('5','h'), card('6','c')],  // low rundown
      [card('K','d'), card('K','c'), card('K','s'), card('Q','h'), card('Q','d')],  // KKKQQ
    ];
    for (const hole of hands) {
      const result = evaluatePreflopPLO5(hole);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });
});
