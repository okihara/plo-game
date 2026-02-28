import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPostflopDecision } from '../postflopStrategy.js';
import {
  c,
  makeHandEval,
  makeBoardTexture,
  makePersonality,
  makeStreetHistory,
  makeGameState,
  makePlayer,
} from './testHelpers.js';

// ランダム値を制御して確定的なテストにする
let mathRandomSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mathRandomSpy = vi.spyOn(Math, 'random');
});

afterEach(() => {
  mathRandomSpy.mockRestore();
});

/** Math.random が常に指定値を返すように設定 */
function setRandom(value: number) {
  mathRandomSpy.mockReturnValue(value);
}

/** リバーで相手のベットに直面する GameState を作成 */
function makeRiverFacingBet(betSize: number, pot: number = 100) {
  return makeGameState({
    currentStreet: 'river',
    pot,
    currentBet: betSize,
    currentPlayerIndex: 0,
    players: [
      makePlayer({ id: 0, chips: 1000, currentBet: 0 }),
      makePlayer({ id: 1, chips: 1000, currentBet: betSize }),
    ],
  });
}

describe('getPostflopDecision', () => {
  describe('リバーナッツ → playMonster', () => {
    it('nutRank=1 のリバーではフォールドしない', () => {
      setRandom(0.99); // スロープレイしないように高い値
      const state = makeRiverFacingBet(80, 100);
      const handEval = makeHandEval({
        madeHandRank: 6,
        strength: 0.9,
        isNuts: false,
        isNearNuts: false,
        nutRank: 1,
        estimatedEquity: 0.95,
      });
      const boardTexture = makeBoardTexture({ flushPossible: true, isWet: true });
      const personality = makePersonality();
      const streetHistory = makeStreetHistory();

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).not.toBe('fold');
    });
  });

  describe('ハイカード + リバーベット → 100% フォールド', () => {
    it('ハイカード(rank 1)でリバーベットに直面 → フォールド', () => {
      setRandom(0.5);
      const state = makeRiverFacingBet(50, 100);
      const handEval = makeHandEval({
        madeHandRank: 1,
        strength: 0.1,
        estimatedEquity: 0.05,
      });
      const boardTexture = makeBoardTexture();
      const personality = makePersonality();
      const streetHistory = makeStreetHistory();

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).toBe('fold');
    });
  });

  describe('ワンペア + リバー大ベット → 高確率フォールド', () => {
    it('ワンペア(rank 2) + リバー大ベット → 高確率フォールド', () => {
      // foldToRiverBet が高い値で、ランダム値が低い → フォールドしやすい
      setRandom(0.1);
      const state = makeRiverFacingBet(80, 100);
      const handEval = makeHandEval({
        madeHandRank: 2,
        strength: 0.3,
        estimatedEquity: 0.2,
      });
      const boardTexture = makeBoardTexture();
      const personality = makePersonality({ foldToRiverBet: 0.60 });
      const streetHistory = makeStreetHistory();

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).toBe('fold');
    });
  });

  describe('nutRank ベースのフォールド判断（ツーペア+）', () => {
    it('nutRank 4+ + リバー大ベット(>40%pot) → フォールド傾向', () => {
      setRandom(0.1); // 低い値 → フォールドしやすい
      const state = makeRiverFacingBet(60, 100);
      const handEval = makeHandEval({
        madeHandRank: 3, // ツーペア
        strength: 0.5,
        estimatedEquity: 0.4,
        nutRank: 5,
      });
      const boardTexture = makeBoardTexture();
      const personality = makePersonality({ foldToRiverBet: 0.55 });
      const streetHistory = makeStreetHistory();

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).toBe('fold');
    });

    it('nutRank 2 + 小さなベット → フォールドしにくい', () => {
      setRandom(0.5); // 中間値
      const state = makeRiverFacingBet(30, 100); // 30% pot
      const handEval = makeHandEval({
        madeHandRank: 5, // ストレート
        strength: 0.7,
        estimatedEquity: 0.7,
        nutRank: 2,
      });
      const boardTexture = makeBoardTexture();
      const personality = makePersonality({ foldToRiverBet: 0.50 });
      const streetHistory = makeStreetHistory();

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      // nutRank 2 + 30% pot → フォールドしない
      expect(decision.action).not.toBe('fold');
    });
  });

  describe('Cベットに対する弱ハンドのフォールド判定', () => {
    it('弱ハンド(rank ≤ 2, ドローなし) + 相手がアグレッサー → フォールド傾向', () => {
      setRandom(0.1); // 低い → foldToCbet の閾値以下
      const state = makeGameState({
        currentStreet: 'flop',
        pot: 100,
        currentBet: 50,
        currentPlayerIndex: 0,
        communityCards: [c('2h'), c('7d'), c('Kc')],
        players: [
          makePlayer({ id: 0, chips: 1000, currentBet: 0 }),
          makePlayer({ id: 1, chips: 1000, currentBet: 50 }),
        ],
      });
      const handEval = makeHandEval({
        madeHandRank: 1,
        strength: 0.1,
        hasFlushDraw: false,
        hasStraightDraw: false,
        hasWrapDraw: false,
        estimatedEquity: 0.08,
      });
      const boardTexture = makeBoardTexture({ isWet: false, rainbow: true });
      const personality = makePersonality({ foldToCbet: 0.50 });
      // playerIndex 0 はアグレッサーではない → 相手がアグレッサー
      const streetHistory = makeStreetHistory({ preflopAggressor: 1 });

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).toBe('fold');
    });
  });

  describe('チェック可能な場合', () => {
    it('弱ハンド + ベットなし → チェック', () => {
      setRandom(0.99); // ブラフしないように高い値
      const state = makeGameState({
        currentStreet: 'flop',
        pot: 100,
        currentBet: 0,
        currentPlayerIndex: 0,
        communityCards: [c('2h'), c('7d'), c('Kc')],
        players: [
          makePlayer({ id: 0, chips: 1000, currentBet: 0 }),
          makePlayer({ id: 1, chips: 1000, currentBet: 0 }),
        ],
      });
      const handEval = makeHandEval({
        madeHandRank: 1,
        strength: 0.1,
        estimatedEquity: 0.08,
      });
      const boardTexture = makeBoardTexture();
      const personality = makePersonality({ bluffFreq: 0 }); // ブラフしない
      const streetHistory = makeStreetHistory({ preflopAggressor: 1 });

      const decision = getPostflopDecision(
        state, 0, handEval, boardTexture, streetHistory, personality, 0
      );
      expect(decision.action).toBe('check');
    });
  });

  describe('統計的テスト', () => {
    it('nutRank 4+ のリバー大ベットに対して50%以上フォールド', () => {
      mathRandomSpy.mockRestore(); // 実際のランダムを使う

      let foldCount = 0;
      const trials = 200;

      for (let i = 0; i < trials; i++) {
        const state = makeRiverFacingBet(80, 100);
        const handEval = makeHandEval({
          madeHandRank: 3,
          strength: 0.5,
          estimatedEquity: 0.4,
          nutRank: 5,
        });
        const boardTexture = makeBoardTexture();
        const personality = makePersonality({ foldToRiverBet: 0.55 });
        const streetHistory = makeStreetHistory();

        const decision = getPostflopDecision(
          state, 0, handEval, boardTexture, streetHistory, personality, 0
        );
        if (decision.action === 'fold') foldCount++;
      }

      const foldRate = foldCount / trials;
      // nutRank 5 + 80% pot bet → 高いフォールド率（50%以上）を期待
      expect(foldRate).toBeGreaterThan(0.5);
    });

    it('nutRank 1 のリバーではフォールド率 0%', () => {
      mathRandomSpy.mockRestore();

      let foldCount = 0;
      const trials = 100;

      for (let i = 0; i < trials; i++) {
        const state = makeRiverFacingBet(80, 100);
        const handEval = makeHandEval({
          madeHandRank: 6,
          strength: 0.9,
          isNuts: false,
          nutRank: 1,
          estimatedEquity: 0.95,
        });
        const boardTexture = makeBoardTexture({ flushPossible: true, isWet: true });
        const personality = makePersonality();
        const streetHistory = makeStreetHistory();

        const decision = getPostflopDecision(
          state, 0, handEval, boardTexture, streetHistory, personality, 0
        );
        if (decision.action === 'fold') foldCount++;
      }

      expect(foldCount).toBe(0);
    });
  });
});
