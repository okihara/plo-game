import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getPreflopDecision } from '../preflopStrategy.js';
import { c, makePersonality, makeGameState, makePlayer } from './testHelpers.js';
import type { GameAction, Card, Position } from '../../types.js';

// Math.random を制御
let mathRandomSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  mathRandomSpy = vi.spyOn(Math, 'random');
});

afterEach(() => {
  mathRandomSpy.mockRestore();
});

function setRandom(value: number) {
  mathRandomSpy.mockReturnValue(value);
}

// --- ヘルパー ---

/** 6人テーブルのプリフロップ GameState を作成 */
function makePreflopState(opts: {
  heroIndex: number;
  heroPosition: string;
  heroCards: Card[];
  currentBet?: number;
  pot?: number;
  handHistory?: GameAction[];
  heroCurrentBet?: number;
}) {
  const bb = 10;
  const positions: Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
  const players = positions.map((pos, i) =>
    makePlayer({
      id: i,
      name: `Player${i}`,
      position: pos,
      chips: 1000,
      holeCards: i === opts.heroIndex ? opts.heroCards : [c('2h'), c('3d'), c('4c'), c('5s')],
      currentBet: pos === 'SB' ? 5 : pos === 'BB' ? bb : 0,
    })
  );

  if (opts.heroCurrentBet !== undefined) {
    players[opts.heroIndex].currentBet = opts.heroCurrentBet;
  }

  return makeGameState({
    players,
    currentStreet: 'preflop',
    pot: opts.pot ?? 15,
    currentBet: opts.currentBet ?? bb,
    currentPlayerIndex: opts.heroIndex,
    bigBlind: bb,
    smallBlind: 5,
    minRaise: bb,
    handHistory: opts.handHistory ?? [],
    dealerPosition: 3, // BTN
  });
}

// 代表的なハンド
const PREMIUM_HAND: Card[] = [c('Ah'), c('Ad'), c('Kh'), c('Kd')]; // AAKKds
const STRONG_HAND: Card[] = [c('Kh'), c('Qd'), c('Jh'), c('Td')]; // KQJTds
const MEDIUM_HAND: Card[] = [c('Th'), c('9d'), c('8h'), c('7d')]; // T987ds
const WEAK_HAND: Card[] = [c('Qh'), c('8d'), c('3c'), c('2s')];   // Q832 rainbow
const TRASH_HAND: Card[] = [c('9h'), c('5d'), c('3c'), c('2s')];   // 9532 rainbow
const AA_WEAK: Card[] = [c('Ah'), c('Ad'), c('7c'), c('3s')];      // AAxx rainbow

const TAG = makePersonality({ name: 'TAG', vpip: 0.20, pfr: 0.15 });
const LAG = makePersonality({ name: 'LAG', vpip: 0.38, pfr: 0.28 });
const BALANCED = makePersonality({ vpip: 0.28, pfr: 0.20 });

// ポジションボーナス
const POS_BTN = 0.10;
const POS_CO = 0.08;
const POS_UTG = 0.00;
const POS_BB = -0.05;
const POS_SB = -0.05;

describe('getPreflopDecision', () => {
  // ============================
  // オープンレイズ
  // ============================
  describe('オープンレイズ', () => {
    it('BTNからプレミアムハンドでオープンレイズする', () => {
      setRandom(0.01); // レイズ確定
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: PREMIUM_HAND,
      });
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('raise');
      expect(result.amount).toBeGreaterThan(state.bigBlind);
    });

    it('BTNから強いハンド(KQJTds)でオープンレイズする', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: STRONG_HAND,
      });
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('raise');
    });

    it('UTGから弱いハンド(Q832r)ではフォールドする', () => {
      setRandom(0.99); // スチールしない
      const state = makePreflopState({
        heroIndex: 0, heroPosition: 'UTG', heroCards: WEAK_HAND,
      });
      const result = getPreflopDecision(state, 0, BALANCED, POS_UTG);
      expect(result.action).toBe('fold');
    });

    it('BTNからでもゴミハンド(9532r)はフォールドする', () => {
      setRandom(0.99);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: TRASH_HAND,
      });
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('fold');
    });

    it('UTGからミドルランダウン(T987ds)はTAGならフォールド', () => {
      setRandom(0.99);
      const state = makePreflopState({
        heroIndex: 0, heroPosition: 'UTG', heroCards: MEDIUM_HAND,
      });
      const result = getPreflopDecision(state, 0, TAG, POS_UTG);
      // T987ds score≈0.67, TAG vpipThreshold≈0.72, UTG+0.00 → eff=0.67 < 0.72 → fold
      expect(result.action).toBe('fold');
    });

    it('BTNからミドルランダウン(T987ds)はレイズする', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: MEDIUM_HAND,
      });
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('raise');
    });

    it('マージナルハンドでリンプしない（未レイズポットでフォールド）', () => {
      // VPIP圏だがPFR圏外 → 未レイズポットではフォールド
      setRandom(0.99);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: MEDIUM_HAND,
      });
      // LAGのvpipThreshold=0.59, pfrThreshold≈0.67
      // T987ds score≈0.67, BTN+0.10 → eff=0.77 > pfrThreshold → actually raises
      // Use a weaker hand that falls in VPIP but not PFR range
      const marginalHand: Card[] = [c('7h'), c('6d'), c('5h'), c('4d')]; // 7654ds score≈0.64
      const state2 = makePreflopState({
        heroIndex: 0, heroPosition: 'UTG', heroCards: marginalHand,
      });
      // UTG+0.00 → eff=0.64, LAG vpipThreshold=0.60, pfrThreshold=0.68 → VPIP圏だがPFR圏外
      const result = getPreflopDecision(state2, 0, LAG, POS_UTG);
      // 未レイズポットでマージナルハンド → フォールド（リンプしない）
      expect(result.action).toBe('fold');
    });
  });

  // ============================
  // AAxx 特別処理
  // ============================
  describe('AAxx 特別処理', () => {
    it('AAxx rainbowでも常にレイズ/コールする（フォールドしない）', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 0, heroPosition: 'UTG', heroCards: AA_WEAK,
      });
      const result = getPreflopDecision(state, 0, TAG, POS_UTG);
      expect(result.action).not.toBe('fold');
    });

    it('AAxx でレイズに直面してもフォールドしない', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 5, heroPosition: 'BB', heroCards: AA_WEAK,
        currentBet: 30, pot: 45,
        handHistory: [{ playerId: 3, action: 'raise' as const, amount: 30, street: 'preflop' }],
      });
      const result = getPreflopDecision(state, 5, BALANCED, POS_BB);
      expect(result.action).not.toBe('fold');
    });
  });

  // ============================
  // BB ディフェンス
  // ============================
  describe('BBディフェンス', () => {
    it('BBでオープンレイズに対し強いハンド(KQJTds)でコール/レイズする', () => {
      setRandom(0.5);
      const state = makePreflopState({
        heroIndex: 5, heroPosition: 'BB', heroCards: STRONG_HAND,
        currentBet: 30, pot: 45,
        heroCurrentBet: 10,
        handHistory: [{ playerId: 3, action: 'raise' as const, amount: 30, street: 'preflop' }],
      });
      const result = getPreflopDecision(state, 5, BALANCED, POS_BB);
      expect(['call', 'raise']).toContain(result.action);
    });

    it('BBで弱いハンド(Q832r)はオープンレイズに対しフォールドする', () => {
      setRandom(0.5);
      const state = makePreflopState({
        heroIndex: 5, heroPosition: 'BB', heroCards: WEAK_HAND,
        currentBet: 30, pot: 45,
        heroCurrentBet: 10,
        handHistory: [{ playerId: 3, action: 'raise' as const, amount: 30, street: 'preflop' }],
      });
      const result = getPreflopDecision(state, 5, BALANCED, POS_BB);
      expect(result.action).toBe('fold');
    });

    it('BBでリンプポット（未レイズ）は弱いハンドでもチェックする', () => {
      setRandom(0.5);
      const state = makePreflopState({
        heroIndex: 5, heroPosition: 'BB', heroCards: WEAK_HAND,
        currentBet: 10, pot: 25, // SB+BB+リンパー
      });
      const result = getPreflopDecision(state, 5, BALANCED, POS_BB);
      // currentBet == BB → facingRaise=false → チェック可能
      expect(result.action).toBe('check');
    });

    it('BBでゴミハンド(9532r)はオープンレイズに対しフォールドする', () => {
      setRandom(0.5);
      const state = makePreflopState({
        heroIndex: 5, heroPosition: 'BB', heroCards: TRASH_HAND,
        currentBet: 30, pot: 45,
        heroCurrentBet: 10,
        handHistory: [{ playerId: 3, action: 'raise' as const, amount: 30, street: 'preflop' }],
      });
      const result = getPreflopDecision(state, 5, BALANCED, POS_BB);
      expect(result.action).toBe('fold');
    });
  });

  // ============================
  // 3ベット対応
  // ============================
  describe('3ベット対応', () => {
    const make3BetState = (heroCards: Card[]) => makePreflopState({
      heroIndex: 3, heroPosition: 'BTN', heroCards,
      currentBet: 90, pot: 125,
      heroCurrentBet: 30,
      handHistory: [
        { playerId: 3, action: 'raise' as const, amount: 30, street: 'preflop' },
        { playerId: 5, action: 'raise' as const, amount: 90, street: 'preflop' },
      ],
    });

    it('3ベットに対しプレミアムハンド(AAKKds)はフォールドしない', () => {
      setRandom(0.01);
      const state = make3BetState(PREMIUM_HAND);
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).not.toBe('fold');
    });

    it('3ベットに対し弱いハンド(Q832r)はフォールドする', () => {
      setRandom(0.5);
      const state = make3BetState(WEAK_HAND);
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('fold');
    });

    it('3ベットに対しゴミハンド(9532r)はフォールドする', () => {
      setRandom(0.01);
      const state = make3BetState(TRASH_HAND);
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('fold');
    });
  });

  // ============================
  // 4ベット対応
  // ============================
  describe('4ベット対応', () => {
    const make4BetState = (heroCards: Card[]) => makePreflopState({
      heroIndex: 3, heroPosition: 'BTN', heroCards,
      currentBet: 270, pot: 380,
      heroCurrentBet: 90,
      handHistory: [
        { playerId: 0, action: 'raise' as const, amount: 30, street: 'preflop' },
        { playerId: 3, action: 'raise' as const, amount: 90, street: 'preflop' },
        { playerId: 0, action: 'raise' as const, amount: 270, street: 'preflop' },
      ],
    });

    it('4ベットに対しAAKKdsはコール/レイズする', () => {
      setRandom(0.01);
      const state = make4BetState(PREMIUM_HAND);
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).not.toBe('fold');
    });

    it('4ベットに対し弱いハンド(Q832r)はフォールドする', () => {
      setRandom(0.5);
      const state = make4BetState(WEAK_HAND);
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('fold');
    });
  });

  // ============================
  // パーソナリティ別
  // ============================
  describe('パーソナリティによる差', () => {
    it('TAGはUTGからミドルランダウン(T987ds)をフォールド', () => {
      setRandom(0.99);
      const state = makePreflopState({
        heroIndex: 0, heroPosition: 'UTG', heroCards: MEDIUM_HAND,
      });
      const result = getPreflopDecision(state, 0, TAG, POS_UTG);
      expect(result.action).toBe('fold');
    });

    it('LAGはBTNからミドルランダウン(T987ds)をレイズ', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: MEDIUM_HAND,
      });
      const result = getPreflopDecision(state, 3, LAG, POS_BTN);
      expect(result.action).toBe('raise');
    });
  });

  // ============================
  // レイズサイジング
  // ============================
  describe('レイズサイジング', () => {
    it('オープンレイズはBBの2.5〜4倍程度', () => {
      setRandom(0.01);
      const state = makePreflopState({
        heroIndex: 3, heroPosition: 'BTN', heroCards: STRONG_HAND,
      });
      const result = getPreflopDecision(state, 3, BALANCED, POS_BTN);
      expect(result.action).toBe('raise');
      expect(result.amount).toBeGreaterThanOrEqual(state.bigBlind * 2);
      expect(result.amount).toBeLessThanOrEqual(state.bigBlind * 5);
    });
  });
});
