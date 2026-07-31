import { describe, it, expect } from 'vitest';
import { GameState, Card, Rank, Suit } from '../../../types.js';
import { createInitialGameState } from '../../../gameEngine.js';
import { decidePostflop } from '../evDecision.js';

function c(s: string): Card {
  return { rank: s[0] as Rank, suit: s[1] as Suit };
}
function cards(...specs: string[]): Card[] {
  return specs.map(c);
}

/**
 * リバーでヒーロー(seat 0)が相手(seat 1)のベットに直面している状態を作る。
 * pot はベット込み、currentBet が相手のベット額。
 */
function makeRiverState(opts: {
  hero: Card[];
  board: Card[];
  pot: number;
  betSize: number;
}): GameState {
  const state = createInitialGameState(2000);
  state.smallBlind = 10;
  state.bigBlind = 20;
  state.currentStreet = 'river';
  state.communityCards = opts.board;
  state.pot = opts.pot + opts.betSize;
  state.currentBet = opts.betSize;
  state.players[0].holeCards = opts.hero;
  state.players[0].currentBet = 0;
  state.players[1].holeCards = [];
  state.players[1].currentBet = opts.betSize;
  for (let i = 2; i < 6; i++) state.players[i].folded = true;
  // 相手をリバーのアグレッサーにする
  state.handHistory = [
    { playerId: 1, action: 'raise', amount: 60, street: 'preflop' },
    { playerId: 0, action: 'call', amount: 60, street: 'preflop' },
    { playerId: 1, action: 'bet', amount: opts.betSize, street: 'river' },
  ];
  state.currentPlayerIndex = 0;
  return state;
}

describe('decidePostflop (EVベース意思決定)', () => {
  it('リバーでナッツならポットベットに直面してもフォールドしない', () => {
    // ボード: Ks Qh Jd 7c 2s / ヒーロー: AT を含む → ナッツストレート
    const state = makeRiverState({
      hero: cards('Ah', 'Th', '3c', '4d'),
      board: cards('Ks', 'Qh', 'Jd', '7c', '2s'),
      pot: 200,
      betSize: 200,
    });
    const decision = decidePostflop(state, 0);
    expect(decision.action).not.toBe('fold');
  });

  it('リバーで完全な空気ハンドはポットベットに大半フォールドする', () => {
    // ボード: Kh Qs 7d 8c 2h / ヒーロー: ノーペア・ロー
    const state = makeRiverState({
      hero: cards('3c', '4d', '5s', '9h'),
      board: cards('Kh', 'Qs', '7d', '8c', '2h'),
      pot: 200,
      betSize: 200,
    });
    const decision = decidePostflop(state, 0);
    expect(decision.action).toBe('fold');
  });

  it('リバーの小型ベット(20%pot)にはツーペアで降りない', () => {
    // ボード: Kh Qs 7d 8c 2h / ヒーロー: KQ ツーペア
    const state = makeRiverState({
      hero: cards('Kd', 'Qc', '3c', '4d'),
      board: cards('Kh', 'Qs', '7d', '8c', '2h'),
      pot: 200,
      betSize: 40,
    });
    const decision = decidePostflop(state, 0);
    expect(decision.action).not.toBe('fold');
  });

  it('同一状態では決定的（ハンド内シードの一貫性）', () => {
    const make = () => makeRiverState({
      hero: cards('Kd', 'Qc', '3c', '4d'),
      board: cards('Kh', 'Qs', '7d', '8c', '2h'),
      pot: 200,
      betSize: 150,
    });
    const d1 = decidePostflop(make(), 0);
    const d2 = decidePostflop(make(), 0);
    expect(d1).toEqual(d2);
  });
});
