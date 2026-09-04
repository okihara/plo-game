import { describe, it, expect } from 'vitest';
import {
  createInitialGameState,
  startNewHand,
  applyAction,
  getValidActions,
  determineNextAction,
  rotatePositions,
} from '../gameEngine.js';
import { POSITIONS_9, getRingPositions } from '../types.js';
import type { GameState, Position } from '../types.js';

// ===== ヘルパー =====

/** 指定席を空席に（startNewHand 前のテーブル構成用） */
function setPlayersSittingOut(state: GameState, indices: readonly number[]) {
  for (const i of indices) {
    state.players[i].isSittingOut = true;
    state.players[i].chips = 0;
  }
}

/** アクティブ（非空席）プレイヤーのポジションを seatIndex 順に返す */
function activePositions(state: GameState): { seat: number; position: Position }[] {
  return state.players
    .map((p, seat) => ({ seat, position: p.position, sittingOut: p.isSittingOut }))
    .filter(x => !x.sittingOut)
    .map(({ seat, position }) => ({ seat, position }));
}

// ===== テスト =====

describe('createInitialGameState (9-max)', () => {
  it('seatCount=9 で9人のプレイヤーを作成する', () => {
    const state = createInitialGameState(600, 9);
    expect(state.players).toHaveLength(9);
    for (const p of state.players) {
      expect(p.chips).toBe(600);
      expect(p.name).toBeTruthy();
    }
  });

  it('ポジションが POSITIONS_9 のリング順になる', () => {
    const state = createInitialGameState(600, 9);
    expect(state.players.map(p => p.position)).toEqual(POSITIONS_9);
  });

  it('seatCount 省略時は従来どおり6人', () => {
    const state = createInitialGameState();
    expect(state.players).toHaveLength(6);
  });
});

describe('startNewHand (9-max)', () => {
  it('9人フルリングで BTN/SB/BB/UTG/UTG1/UTG2/LJ/HJ/CO が割り当たる', () => {
    const state = createInitialGameState(600, 9);
    const newState = startNewHand(state);
    const positions = newState.players.map(p => p.position);
    expect([...positions].sort()).toEqual([...POSITIONS_9].sort());
    // ディーラーから時計回りに BTN → SB → BB → … のリング順
    const d = newState.dealerPosition;
    for (let i = 0; i < 9; i++) {
      expect(newState.players[(d + i) % 9].position).toBe(POSITIONS_9[i]);
    }
  });

  it('9人でブラインドが正しく投稿され、UTG からアクション開始', () => {
    const state = createInitialGameState(600, 9);
    const newState = startNewHand(state);
    const d = newState.dealerPosition;
    const sb = (d + 1) % 9;
    const bb = (d + 2) % 9;
    const utg = (d + 3) % 9;
    expect(newState.players[sb].currentBet).toBe(newState.smallBlind);
    expect(newState.players[bb].currentBet).toBe(newState.bigBlind);
    expect(newState.currentPlayerIndex).toBe(utg);
    expect(newState.pot).toBe(newState.smallBlind + newState.bigBlind);
  });

  it('9人全員に4枚ずつ配られる（PLO）', () => {
    const state = createInitialGameState(600, 9);
    const newState = startNewHand(state);
    for (const p of newState.players) {
      expect(p.holeCards).toHaveLength(4);
    }
    // 9人 × 4枚 = 36枚がデッキから減る
    expect(newState.deck.length).toBe(52 - 36);
  });

  it('7人（空席2つ）で UTG/UTG1/HJ/CO が割り当たる', () => {
    const state = createInitialGameState(600, 9);
    setPlayersSittingOut(state, [4, 7]);
    const newState = startNewHand(state);
    const labels = activePositions(newState).map(x => x.position);
    expect([...labels].sort()).toEqual(
      ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'HJ', 'CO'].sort()
    );
  });

  it('8人（空席1つ）で UTG/UTG1/LJ/HJ/CO が割り当たる', () => {
    const state = createInitialGameState(600, 9);
    setPlayersSittingOut(state, [5]);
    const newState = startNewHand(state);
    const labels = activePositions(newState).map(x => x.position);
    expect([...labels].sort()).toEqual(
      ['BTN', 'SB', 'BB', 'UTG', 'UTG1', 'LJ', 'HJ', 'CO'].sort()
    );
  });

  it('9-max 卓の2人プレイ（ヘッズアップ）は BTN/BB になる', () => {
    const state = createInitialGameState(600, 9);
    setPlayersSittingOut(state, [1, 2, 3, 4, 5, 6, 7]);
    const newState = startNewHand(state);
    const labels = activePositions(newState).map(x => x.position);
    expect([...labels].sort()).toEqual(['BB', 'BTN'].sort());
  });
});

describe('手番進行 (9-max)', () => {
  it('seat 6-8 をまたいでアクションが循環する', () => {
    const state = createInitialGameState(600, 9);
    let s = startNewHand(state);
    // UTG から全員コールしていき、手番が seat 8 を超えて 0 に戻ることを確認
    const visited: number[] = [];
    for (let guard = 0; guard < 12; guard++) {
      const idx = s.currentPlayerIndex;
      if (idx === -1) break;
      visited.push(idx);
      const valid = getValidActions(s, idx);
      const call = valid.find(v => v.action === 'call') ?? valid.find(v => v.action === 'check');
      expect(call).toBeTruthy();
      s = applyAction(s, idx, call!.action, call!.minAmount);
      const next = determineNextAction(s);
      if (next.moveToNextStreet) break;
      s = { ...s, currentPlayerIndex: next.nextPlayerIndex };
    }
    // 9席全員が一度ずつ手番を持つ（プリフロップ: UTG→…→BB）
    expect(new Set(visited).size).toBe(9);
  });
});

describe('rotatePositions (9-max)', () => {
  it('ディーラーが9席で一周する', () => {
    let state = createInitialGameState(600, 9);
    const startDealer = state.dealerPosition;
    for (let i = 0; i < 9; i++) {
      state = rotatePositions(state);
    }
    expect(state.dealerPosition).toBe(startDealer);
    // ポジションはリング順を維持
    const d = state.dealerPosition;
    const ring = getRingPositions(9);
    for (let i = 0; i < 9; i++) {
      expect(state.players[(d + i) % 9].position).toBe(ring[i]);
    }
  });
});

describe('リグレッション: 6-max の挙動不変', () => {
  it('6人フルリングのポジションは従来どおり', () => {
    const state = createInitialGameState(600);
    const newState = startNewHand(state);
    const d = newState.dealerPosition;
    const expected = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    for (let i = 0; i < 6; i++) {
      expect(newState.players[(d + i) % 6].position).toBe(expected[i]);
    }
  });
});
