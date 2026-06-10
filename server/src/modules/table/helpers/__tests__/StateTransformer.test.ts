import { describe, it, expect } from 'vitest';
import { StateTransformer } from '../StateTransformer.js';
import { createInitialGameState } from '../../../../shared/logic/gameEngine.js';
import { PendingAction } from '../../types.js';

// =========================================================================
//  actionSeq（決定ポイントID）の配信
//
//  クライアントは「seq X に対してアクション送信済み」を ClientGameState.actionSeq
//  と突き合わせてロックを導出する。アクション待ちでないときは null になること、
//  pendingAction の seq がそのまま届くことが契約。
// =========================================================================

const basePendingAction = (seq: number): PendingAction => ({
  playerId: 'user-1',
  playerName: 'Alice',
  seatNumber: 0,
  validActions: [{ action: 'check', minAmount: 0, maxAmount: 0 }],
  requestedAt: 0,
  timeoutMs: 10000,
  seq,
});

describe('StateTransformer - actionSeq', () => {
  it('pendingAction があるとき seq を actionSeq として配信する', () => {
    const state = StateTransformer.toClientGameState(
      'table-1', [null, null, null, null, null, null],
      createInitialGameState(), basePendingAction(42), true, 1, 3,
    );
    expect(state.actionSeq).toBe(42);
  });

  it('pendingAction がないとき actionSeq は null', () => {
    const state = StateTransformer.toClientGameState(
      'table-1', [null, null, null, null, null, null],
      createInitialGameState(), null, true, 1, 3,
    );
    expect(state.actionSeq).toBeNull();
  });

  it('gameState がないとき（ハンド外）も actionSeq は null', () => {
    const state = StateTransformer.toClientGameState(
      'table-1', [null, null, null, null, null, null],
      null, null, false, 1, 3,
    );
    expect(state.actionSeq).toBeNull();
  });
});
