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
      mathRandomSpy.mockRestore();

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

  // =============================================================
  // nutRank × ベットサイズ × ボード × キャラクター → コール率
  // =============================================================

  describe('シチュエーション別コール率', () => {
    const TRIALS = 500;

    // --- キャラクター定義 ---
    const CHARACTERS = {
      TatsuyaN:  { name: 'TatsuyaN',  foldToRiverBet: 0.50, aggression: 0.80 },
      YuHayashi: { name: 'YuHayashi', foldToRiverBet: 0.50, aggression: 0.80 },
      yuna0312:  { name: 'yuna0312',  foldToRiverBet: 0.58, aggression: 0.60 },
    } as const;

    // --- ボード定義 ---
    const BOARDS = {
      dry:   { flushPossible: false, isPaired: false },
      flush: { flushPossible: true,  isPaired: false },
      paired:{ flushPossible: false, isPaired: true  },
    } as const;

    // --- madeHandRank 目安 ---
    // nutRank 1 → ナッツフラッシュ (rank 6)
    // nutRank 2 → セカンドナッツフラッシュ (rank 6) / ストレート (rank 5)
    // nutRank 3 → ストレート (rank 5)
    // nutRank 4 → セット (rank 4)
    // nutRank 5 → ツーペア (rank 3)

    /** 指定条件でN回試行し、コール率を返す */
    function measureCallRate(params: {
      betSize: number;
      pot?: number;
      madeHandRank: number;
      nutRank?: number;
      estimatedEquity?: number;
      board: keyof typeof BOARDS;
      character: keyof typeof CHARACTERS;
    }): number {
      const {
        betSize, pot = 100, madeHandRank, nutRank,
        estimatedEquity = 0.3, board, character,
      } = params;
      const boardDef = BOARDS[board];
      const charDef = CHARACTERS[character];

      let callCount = 0;
      for (let i = 0; i < TRIALS; i++) {
        const state = makeRiverFacingBet(betSize, pot);
        const handEval = makeHandEval({
          madeHandRank,
          strength: madeHandRank * 0.15,
          estimatedEquity,
          nutRank,
        });
        const boardTexture = makeBoardTexture({
          flushPossible: boardDef.flushPossible,
          isWet: boardDef.flushPossible,
          isPaired: boardDef.isPaired,
        });
        const personality = makePersonality(charDef);
        const streetHistory = makeStreetHistory();

        const decision = getPostflopDecision(
          state, 0, handEval, boardTexture, streetHistory, personality, 0
        );
        if (decision.action !== 'fold') callCount++;
      }
      return callCount / TRIALS;
    }

    // =========================================================
    // nutRank 1 (ナッツ) — 絶対にフォールドしない
    // =========================================================
    describe('nutRank 1 (ナッツ)', () => {
      it.each([
        { board: 'flush' as const, bet: 'ポットベット', betSize: 100 },
        { board: 'dry'   as const, bet: 'ポットベット', betSize: 100 },
        { board: 'paired'as const, bet: 'ポットベット', betSize: 100 },
      ])('$board ボード + $bet → 全キャラ コール率 100%', ({ board, betSize }) => {
        mathRandomSpy.mockRestore();
        for (const char of Object.keys(CHARACTERS) as (keyof typeof CHARACTERS)[]) {
          const callRate = measureCallRate({
            betSize, madeHandRank: 6, nutRank: 1,
            estimatedEquity: 0.95, board, character: char,
          });
          expect(callRate).toBe(1.0);
        }
      });
    });

    // =========================================================
    // nutRank 2 (セカンドナッツ) — ほとんどコール
    // =========================================================
    describe('nutRank 2 (セカンドナッツ)', () => {
      it.each([
        { board: 'dry'   as const, bet: 'ポットベット',     betSize: 100, minCall: 0.75 },
        { board: 'dry'   as const, bet: 'ハーフポットベット', betSize: 50,  minCall: 0.85 },
        { board: 'flush' as const, bet: 'ポットベット',     betSize: 100, minCall: 0.70 },
      ])('$board ボード + $bet → 全キャラ コール率 $minCall 以上', ({ board, betSize, minCall }) => {
        mathRandomSpy.mockRestore();
        for (const char of Object.keys(CHARACTERS) as (keyof typeof CHARACTERS)[]) {
          const callRate = measureCallRate({
            betSize, madeHandRank: 6, nutRank: 2,
            estimatedEquity: 0.85, board, character: char,
          });
          expect(callRate).toBeGreaterThanOrEqual(minCall);
        }
      });
    });

    // =========================================================
    // nutRank 3 — ベットサイズで判断が分かれる
    // =========================================================
    describe('nutRank 3', () => {
      it.each([
        { char: 'TatsuyaN'  as const, board: 'dry' as const, betSize: 50,  min: 0.40, max: 0.80 },
        { char: 'TatsuyaN'  as const, board: 'dry' as const, betSize: 100, min: 0.20, max: 0.60 },
        { char: 'yuna0312'  as const, board: 'dry' as const, betSize: 100, min: 0.15, max: 0.55 },
      ])('$char / $board ボード / betSize=$betSize → コール率 $min-$max', ({ char, board, betSize, min, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 5, nutRank: 3,
          estimatedEquity: 0.55, board, character: char,
        });
        expect(callRate).toBeGreaterThanOrEqual(min);
        expect(callRate).toBeLessThanOrEqual(max);
      });

      // フラッシュボードでは nutRank 3 でもフラッシュ未保持ならさらに下がる
      it.each([
        { char: 'TatsuyaN'  as const, betSize: 100, max: 0.10 },
        { char: 'yuna0312'  as const, betSize: 100, max: 0.10 },
      ])('$char / flush ボード / betSize=$betSize → コール率 $max 以下', ({ char, betSize, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 5, nutRank: 3,
          estimatedEquity: 0.25, board: 'flush', character: char,
        });
        expect(callRate).toBeLessThanOrEqual(max);
      });
    });

    // =========================================================
    // nutRank 4 — 高確率でフォールド
    // =========================================================
    describe('nutRank 4', () => {
      it.each([
        { char: 'TatsuyaN'  as const, board: 'dry'   as const, betSize: 100, min: 0.05, max: 0.30 },
        { char: 'TatsuyaN'  as const, board: 'dry'   as const, betSize: 50,  min: 0.10, max: 0.45 },
        { char: 'yuna0312'  as const, board: 'dry'   as const, betSize: 100, min: 0.03, max: 0.20 },
        { char: 'TatsuyaN'  as const, board: 'paired'as const, betSize: 100, min: 0.00, max: 0.20 },
      ])('$char / $board ボード / betSize=$betSize → コール率 $min-$max', ({ char, board, betSize, min, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 4, nutRank: 4,
          estimatedEquity: 0.30, board, character: char,
        });
        expect(callRate).toBeGreaterThanOrEqual(min);
        expect(callRate).toBeLessThanOrEqual(max);
      });

      // フラッシュボード + セット → ほぼフォールド
      it.each([
        { char: 'TatsuyaN'  as const, betSize: 100, max: 0.10 },
        { char: 'YuHayashi' as const, betSize: 100, max: 0.10 },
        { char: 'yuna0312'  as const, betSize: 100, max: 0.10 },
      ])('$char / flush ボード / betSize=$betSize → コール率 $max 以下', ({ char, betSize, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 4, nutRank: 4,
          estimatedEquity: 0.20, board: 'flush', character: char,
        });
        expect(callRate).toBeLessThanOrEqual(max);
      });
    });

    // =========================================================
    // nutRank 5+ — ほぼフォールド
    // =========================================================
    describe('nutRank 5+ (ツーペア以下)', () => {
      // ドライボードでもポットベットにはほぼフォールド
      it.each([
        { char: 'TatsuyaN'  as const, board: 'dry'   as const, betSize: 100, max: 0.25 },
        { char: 'yuna0312'  as const, board: 'dry'   as const, betSize: 100, max: 0.15 },
        { char: 'TatsuyaN'  as const, board: 'dry'   as const, betSize: 50,  max: 0.40 },
      ])('$char / $board ボード / betSize=$betSize → コール率 $max 以下', ({ char, board, betSize, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 3, nutRank: 5,
          estimatedEquity: 0.20, board, character: char,
        });
        expect(callRate).toBeLessThanOrEqual(max);
      });

      // フラッシュボード → ポットベットにほぼ絶対フォールド
      it.each([
        { char: 'TatsuyaN'  as const, betSize: 100, max: 0.05 },
        { char: 'YuHayashi' as const, betSize: 100, max: 0.05 },
        { char: 'yuna0312'  as const, betSize: 100, max: 0.05 },
        { char: 'TatsuyaN'  as const, betSize: 50,  max: 0.25 },
        { char: 'yuna0312'  as const, betSize: 50,  max: 0.25 },
      ])('$char / flush ボード / betSize=$betSize → コール率 $max 以下', ({ char, betSize, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 3, nutRank: 5,
          estimatedEquity: 0.15, board: 'flush', character: char,
        });
        expect(callRate).toBeLessThanOrEqual(max);
      });

      // ペアボード + ツーペア → フルハウスの脅威
      it.each([
        { char: 'TatsuyaN'  as const, betSize: 100, max: 0.20 },
        { char: 'yuna0312'  as const, betSize: 100, max: 0.15 },
      ])('$char / paired ボード / betSize=$betSize → コール率 $max 以下', ({ char, betSize, max }) => {
        mathRandomSpy.mockRestore();
        const callRate = measureCallRate({
          betSize, madeHandRank: 3, nutRank: 5,
          estimatedEquity: 0.20, board: 'paired', character: char,
        });
        expect(callRate).toBeLessThanOrEqual(max);
      });
    });
  });
});
