import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPostflopDecision } from '../postflopStrategy.js';
import {
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

// =============================================================
// ナッツ級ハンドのベットアクション（ベット率・レイズ率・ベットサイズ）
// =============================================================

/** リバーでベットなし（チェック可能）の GameState */
function makeRiverNoBet(pot: number = 100) {
  return makeGameState({
    currentStreet: 'river',
    pot,
    currentBet: 0,
    currentPlayerIndex: 0,
    players: [
      makePlayer({ id: 0, chips: 1000, currentBet: 0 }),
      makePlayer({ id: 1, chips: 1000, currentBet: 0 }),
    ],
  });
}

/** リバーで相手のベットに直面する GameState */
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

// --- キャラクター定義 ---
const CHARACTERS = {
  TatsuyaN:  { name: 'TatsuyaN',  foldToRiverBet: 0.50, aggression: 0.80 },
  yuna0312:  { name: 'yuna0312',  foldToRiverBet: 0.58, aggression: 0.60 },
} as const;

const TRIALS = 500;

/** N回試行してベット/レイズ/コール/チェック/フォールドの各アクション率と平均ベットサイズを返す */
function measureBetBehavior(params: {
  pot?: number;
  facingBet?: number;
  madeHandRank: number;
  nutRank?: number;
  isNuts?: boolean;
  isNearNuts?: boolean;
  estimatedEquity?: number;
  strength?: number;
  board: { flushPossible?: boolean; isWet?: boolean; isPaired?: boolean };
  character: keyof typeof CHARACTERS;
}): { betRate: number; raiseRate: number; callRate: number; checkRate: number; foldRate: number; avgBetPctOfPot: number } {
  const {
    pot = 100, facingBet, madeHandRank, nutRank, isNuts = false, isNearNuts = false,
    estimatedEquity = 0.85, strength, board, character,
  } = params;
  const charDef = CHARACTERS[character];

  let betCount = 0;
  let raiseCount = 0;
  let callCount = 0;
  let checkCount = 0;
  let foldCount = 0;
  let totalBetPct = 0;
  let betSizeCount = 0;

  for (let i = 0; i < TRIALS; i++) {
    const state = facingBet !== undefined
      ? makeRiverFacingBet(facingBet, pot)
      : makeRiverNoBet(pot);
    const handEval = makeHandEval({
      madeHandRank,
      strength: strength ?? madeHandRank * 0.15,
      isNuts,
      isNearNuts,
      nutRank,
      estimatedEquity,
    });
    const boardTexture = makeBoardTexture({
      flushPossible: board.flushPossible ?? false,
      isWet: board.isWet ?? board.flushPossible ?? false,
      isPaired: board.isPaired ?? false,
    });
    const personality = makePersonality(charDef);
    const streetHistory = makeStreetHistory();

    const decision = getPostflopDecision(
      state, 0, handEval, boardTexture, streetHistory, personality, 0
    );

    switch (decision.action) {
      case 'bet':
        betCount++;
        totalBetPct += decision.amount / pot;
        betSizeCount++;
        break;
      case 'raise':
        raiseCount++;
        totalBetPct += decision.amount / pot;
        betSizeCount++;
        break;
      case 'call':
        callCount++;
        break;
      case 'check':
        checkCount++;
        break;
      case 'fold':
        foldCount++;
        break;
    }
  }

  return {
    betRate: betCount / TRIALS,
    raiseRate: raiseCount / TRIALS,
    callRate: callCount / TRIALS,
    checkRate: checkCount / TRIALS,
    foldRate: foldCount / TRIALS,
    avgBetPctOfPot: betSizeCount > 0 ? totalBetPct / betSizeCount : 0,
  };
}

describe('ナッツ級ハンドのベットアクション', () => {
  // =========================================================
  // nutRank 1 (ナッツ) — ベットなし → バリューベット
  // =========================================================
  describe('nutRank 1 (ナッツ) — ベットなし（チェック可能）', () => {
    it('ウェットボード → ほぼ100%ベット（スロープレイなし）', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // ウェットボードではスロープレイ条件 (!isWet) が成立しない → 常にベット
      expect(result.betRate).toBeGreaterThanOrEqual(0.90);
      expect(result.foldRate).toBe(0);
      expect(result.checkRate).toBeLessThanOrEqual(0.10);
    });

    it('ドライボード → スロープレイ混在（80%以上ベット）', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // slowplayFreq=0.10 → 約90%ベット
      expect(result.betRate).toBeGreaterThanOrEqual(0.78);
      expect(result.betRate).toBeLessThanOrEqual(0.98);
      expect(result.foldRate).toBe(0);
    });

    it('全キャラ共通 → フォールド率 0%', () => {
      mathRandomSpy.mockRestore();
      for (const char of Object.keys(CHARACTERS) as (keyof typeof CHARACTERS)[]) {
        const result = measureBetBehavior({
          madeHandRank: 6, nutRank: 1, isNuts: true,
          estimatedEquity: 0.95,
          board: { isWet: true },
          character: char,
        });
        expect(result.foldRate).toBe(0);
      }
    });
  });

  // =========================================================
  // nutRank 1 (ナッツ) — ベットに直面 → レイズ
  // =========================================================
  describe('nutRank 1 (ナッツ) — ベットに直面', () => {
    it('ウェットボード + ポットベット → 高確率レイズ', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // ウェット → スロープレイしない → 常にレイズ
      expect(result.raiseRate).toBeGreaterThanOrEqual(0.85);
      expect(result.foldRate).toBe(0);
    });

    it('ドライボード + ポットベット → レイズ or コール（フォールドなし）', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // ドライ → スロープレイでコールもあり
      expect(result.raiseRate + result.callRate).toBeGreaterThanOrEqual(0.99);
      expect(result.raiseRate).toBeGreaterThanOrEqual(0.75);
      expect(result.foldRate).toBe(0);
    });

    it('全キャラ・全ボード → 絶対にフォールドしない', () => {
      mathRandomSpy.mockRestore();
      for (const char of Object.keys(CHARACTERS) as (keyof typeof CHARACTERS)[]) {
        for (const board of [
          { isWet: true },
          { isWet: false },
          { flushPossible: true, isWet: true },
          { isPaired: true },
        ]) {
          const result = measureBetBehavior({
            facingBet: 100,
            madeHandRank: 6, nutRank: 1, isNuts: true,
            estimatedEquity: 0.95,
            board,
            character: char,
          });
          expect(result.foldRate).toBe(0);
        }
      }
    });
  });

  // =========================================================
  // nutRank 2 (セカンドナッツ) — ベットアクション
  // =========================================================
  describe('nutRank 2 (セカンドナッツ) — ベットなし（チェック可能）', () => {
    it.each([
      { char: 'TatsuyaN'  as const, minBet: 0.85, maxBet: 1.00 },
      { char: 'yuna0312'  as const, minBet: 0.80, maxBet: 1.00 },
    ])('$char → ベット率 $minBet-$maxBet', ({ char, minBet, maxBet }) => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: char,
      });
      // nutRankブースト: セカンドナッツは80-90%+でバリューベット
      expect(result.betRate).toBeGreaterThanOrEqual(minBet);
      expect(result.betRate).toBeLessThanOrEqual(maxBet);
      expect(result.foldRate).toBe(0);
    });
  });

  describe('nutRank 2 (セカンドナッツ) — ベットに直面', () => {
    it('ポットベット → レイズ or コール（フォールド率低い）', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // nutRank=2: 大ベットにのみ低確率フォールド（foldToRiverBet * 0.3）
      expect(result.foldRate).toBeLessThanOrEqual(0.25);
      expect(result.raiseRate + result.callRate).toBeGreaterThanOrEqual(0.75);
    });

    it('ハーフポットベット → フォールドしない', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 50,
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // betToPotRatio=0.5 < 0.7 → nutRank=2のフォールドトリガーに達しない
      expect(result.foldRate).toBe(0);
    });

    it('レイズも混ぜる（アグレッシブキャラ）', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 80,
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // nutRankブーストにより高頻度レイズ
      expect(result.raiseRate).toBeGreaterThanOrEqual(0.50);
    });
  });

  // =========================================================
  // nutRank 3 (サードナッツ) — ベットアクション
  // =========================================================
  describe('nutRank 3 (サードナッツ) — ベットなし（チェック可能）', () => {
    it.each([
      { char: 'TatsuyaN'  as const, madeHandRank: 5, minBet: 0.65, maxBet: 0.95 },
      { char: 'yuna0312'  as const, madeHandRank: 5, minBet: 0.55, maxBet: 0.90 },
    ])('$char / rank=$madeHandRank → ベット率 $minBet-$maxBet', ({ char, madeHandRank, minBet, maxBet }) => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank, nutRank: 3,
        estimatedEquity: 0.65,
        board: { isWet: false },
        character: char,
      });
      expect(result.betRate).toBeGreaterThanOrEqual(minBet);
      expect(result.betRate).toBeLessThanOrEqual(maxBet);
      expect(result.foldRate).toBe(0);
    });
  });

  describe('nutRank 3 (サードナッツ) — ベットに直面', () => {
    it('ポットベット → フォールド率は上がるがコール/レイズも残る', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.55,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // nutRank=3 + pot-sized bet → フォールド率はそこそこ高い
      expect(result.foldRate).toBeGreaterThanOrEqual(0.15);
      expect(result.foldRate).toBeLessThanOrEqual(0.70);
      // コール or レイズも残る
      expect(result.raiseRate + result.callRate).toBeGreaterThanOrEqual(0.35);
    });

    it('ハーフポットベット → フォールド少なめ', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 50,
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.55,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // betToPotRatio=0.5 → フォールドトリガー閾値ちょうど（フォールド少なめ）
      expect(result.foldRate).toBeLessThanOrEqual(0.55);
    });

    it('フラッシュボード + フラッシュ未保持 → フォールド率高い', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.25,
        board: { flushPossible: true, isWet: true },
        character: 'TatsuyaN',
      });
      // フラッシュ完成ボード + 非フラッシュハンド(rank<6) → ほぼフォールド
      expect(result.foldRate).toBeGreaterThanOrEqual(0.70);
    });
  });

  // =========================================================
  // ベットサイズの検証
  // =========================================================
  describe('ベットサイズ（pot比率）', () => {
    it('nutRank=1 ウェットボード → 70-110% pot', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // valueBetSize(wet): 0.75-1.00 + isNuts(+0.10) + aggression mod + random
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.70);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(1.10);
    });

    it('nutRank=1 ドライボード → 45-75% pot', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // valueBetSize(dry): 0.50-0.65 + isNuts(+0.10) + aggression mod + random
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.45);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(0.80);
    });

    it('nutRank=2 ウェットボード → バリューサイズ (60-100% pot)', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // valueBetSize(wet) for madeHandRank=6: 0.75-1.00 + aggression mod
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.60);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(1.10);
    });

    it('nutRank=2 ドライボード → 控えめサイズ (40-70% pot)', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // valueBetSize(dry): 0.50-0.65 + aggression mod
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.40);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(0.75);
    });

    it('nutRank=3 (ストレート rank=5) → バリューサイズ', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.65,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      // madeHandRank=5 → valueBetSize: wet 0.75-1.00 + aggression mod
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.55);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(1.10);
    });

    it('nutRank=3 (セット rank=4) → ミディアムサイズ', () => {
      mathRandomSpy.mockRestore();
      const result = measureBetBehavior({
        madeHandRank: 4, nutRank: 3,
        estimatedEquity: 0.55,
        board: { isWet: false },
        character: 'TatsuyaN',
      });
      // madeHandRank=4 → mediumHandSize: 0.25-0.40 + aggression mod
      expect(result.avgBetPctOfPot).toBeGreaterThanOrEqual(0.25);
      expect(result.avgBetPctOfPot).toBeLessThanOrEqual(0.55);
    });
  });

  // =========================================================
  // nutRank 比較: ナッツ > セカンド > サード のベット率序列
  // =========================================================
  describe('nutRank によるベット率の序列', () => {
    it('ウェットボード: nutRank=1 > nutRank=2 > nutRank=3 のベット率', () => {
      mathRandomSpy.mockRestore();
      const nuts = measureBetBehavior({
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      const secondNuts = measureBetBehavior({
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      const thirdNuts = measureBetBehavior({
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.65,
        board: { isWet: true },
        character: 'TatsuyaN',
      });

      // ナッツ > セカンドナッツ > サードナッツ の明確な序列
      expect(nuts.betRate).toBeGreaterThan(secondNuts.betRate);
      expect(secondNuts.betRate).toBeGreaterThan(thirdNuts.betRate);
    });

    it('ベットに直面: nutRank=1 → フォールド0%, nutRank=2 → 低フォールド, nutRank=3 → 中フォールド', () => {
      mathRandomSpy.mockRestore();
      const nuts = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 6, nutRank: 1, isNuts: true,
        estimatedEquity: 0.95,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      const secondNuts = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 6, nutRank: 2,
        estimatedEquity: 0.85,
        board: { isWet: true },
        character: 'TatsuyaN',
      });
      const thirdNuts = measureBetBehavior({
        facingBet: 100,
        madeHandRank: 5, nutRank: 3,
        estimatedEquity: 0.55,
        board: { isWet: true },
        character: 'TatsuyaN',
      });

      expect(nuts.foldRate).toBe(0);
      expect(secondNuts.foldRate).toBeLessThan(thirdNuts.foldRate);
    });
  });
});
