import { describe, it, expect } from 'vitest';
import { processCommand } from '../processCommand.js';
import { createInitialGameState, startNewHand, getValidActions } from '../gameEngine.js';
import type { GameState } from '../../types.js';
import type { GameEvent } from '../types.js';

/** 2人以上アクティブなプリフロップ状態を作成 */
function createHandState(): GameState {
  const state = createInitialGameState();
  return startNewHand(state);
}

/** イベント配列から特定タイプのイベントを取得 */
function findEvent<T extends GameEvent['type']>(
  events: GameEvent[],
  type: T
): Extract<GameEvent, { type: T }> | undefined {
  return events.find(e => e.type === type) as Extract<GameEvent, { type: T }> | undefined;
}

function hasEvent(events: GameEvent[], type: GameEvent['type']): boolean {
  return events.some(e => e.type === type);
}

// ===== テスト =====

describe('processCommand', () => {
  describe('START_HAND', () => {
    it('HAND_STARTED イベントを返す', () => {
      const state = createInitialGameState();
      const result = processCommand(state, { type: 'START_HAND' });

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      const event = findEvent(result.events, 'HAND_STARTED');
      expect(event).toBeDefined();
      expect(event!.dealerSeat).toBeGreaterThanOrEqual(0);
      expect(event!.holeCards.size).toBeGreaterThan(0);
    });

    it('ホールカードに各プレイヤー4枚のカードが含まれる', () => {
      const state = createInitialGameState();
      const result = processCommand(state, { type: 'START_HAND' });

      const event = findEvent(result.events, 'HAND_STARTED')!;
      for (const [, cards] of event.holeCards) {
        expect(cards).toHaveLength(4);
      }
    });

    it('返された状態にブラインドが投稿されている', () => {
      const state = createInitialGameState();
      const result = processCommand(state, { type: 'START_HAND' });

      expect(result.state.pot).toBeGreaterThan(0);
      expect(result.state.currentStreet).toBe('preflop');
    });

    it('全員オールインの場合はアクションでランアウトイベントが発生する', () => {
      // 3人アクティブ、チップ3 → SB=1, BB=3(オールイン) → UTGがallinでランアウト
      const state = createInitialGameState(3);
      state.players[3].isSittingOut = true;
      state.players[4].isSittingOut = true;
      state.players[5].isSittingOut = true;

      const startResult = processCommand(state, { type: 'START_HAND' });
      expect(hasEvent(startResult.events, 'HAND_STARTED')).toBe(true);

      // 最初のプレイヤーがオールイン
      const seatIndex = startResult.state.currentPlayerIndex;
      const result = processCommand(startResult.state, {
        type: 'PLAYER_ACTION',
        seatIndex,
        action: 'allin',
        amount: startResult.state.players[seatIndex].chips,
      });

      // allin後、残りプレイヤーもアクションして全員オールイン → ランアウト
      let finalState = result.state;
      let foundRunout = hasEvent(result.events, 'ALL_IN_RUNOUT');
      let events = result.events;

      while (!finalState.isHandComplete && !foundRunout) {
        const seat = finalState.currentPlayerIndex;
        const validActions = getValidActions(finalState, seat);
        const allinAction = validActions.find(a => a.action === 'allin');
        const callAction = validActions.find(a => a.action === 'call');
        const action = allinAction || callAction;
        if (!action) break;

        const r = processCommand(finalState, {
          type: 'PLAYER_ACTION',
          seatIndex: seat,
          action: action.action,
          amount: action.minAmount,
        });
        foundRunout = foundRunout || hasEvent(r.events, 'ALL_IN_RUNOUT');
        events = r.events;
        finalState = r.state;
      }

      expect(finalState.isHandComplete).toBe(true);
      expect(hasEvent(events, 'HAND_COMPLETED')).toBe(true);
    });
  });

  describe('PLAYER_ACTION - fold', () => {
    it('有効なフォールドで ACTION_APPLIED イベントを返す', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;

      const result = processCommand(state, {
        type: 'PLAYER_ACTION',
        seatIndex,
        action: 'fold',
      });

      expect(result.events.length).toBeGreaterThanOrEqual(1);
      const event = findEvent(result.events, 'ACTION_APPLIED');
      expect(event).toBeDefined();
      expect(event!.seatIndex).toBe(seatIndex);
      expect(event!.action).toBe('fold');
    });

    it('フォールド後にプレイヤーがfolded状態になる', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;

      const result = processCommand(state, {
        type: 'PLAYER_ACTION',
        seatIndex,
        action: 'fold',
      });

      expect(result.state.players[seatIndex].folded).toBe(true);
    });
  });

  describe('PLAYER_ACTION - check', () => {
    it('チェック可能な状況でチェックできる', () => {
      // プリフロップではBBまで回ってBBがチェックできる状況を作る
      // 簡単のため、全員foldさせてBBだけ残す代わりに
      // ポストフロップの状況を作る
      let state = createHandState();

      // 全員コールしてフロップへ
      while (state.currentStreet === 'preflop' && !state.isHandComplete) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const callAction = validActions.find(a => a.action === 'call');
        const checkAction = validActions.find(a => a.action === 'check');

        if (checkAction) {
          const result = processCommand(state, {
            type: 'PLAYER_ACTION',
            seatIndex,
            action: 'check',
          });
          state = result.state;
        } else if (callAction) {
          const result = processCommand(state, {
            type: 'PLAYER_ACTION',
            seatIndex,
            action: 'call',
            amount: callAction.minAmount,
          });
          state = result.state;
        } else {
          break;
        }
      }

      // フロップに来たらチェック可能
      if (state.currentStreet === 'flop' && !state.isHandComplete) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const canCheck = validActions.some(a => a.action === 'check');

        if (canCheck) {
          const result = processCommand(state, {
            type: 'PLAYER_ACTION',
            seatIndex,
            action: 'check',
          });

          const event = findEvent(result.events, 'ACTION_APPLIED');
          expect(event).toBeDefined();
          expect(event!.action).toBe('check');
        }
      }
    });
  });

  describe('PLAYER_ACTION - call', () => {
    it('コールで正しくチップが移動する', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;
      const validActions = getValidActions(state, seatIndex);
      const callAction = validActions.find(a => a.action === 'call');

      if (callAction) {
        const chipsBefore = state.players[seatIndex].chips;
        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: 'call',
          amount: callAction.minAmount,
        });

        expect(result.state.players[seatIndex].chips).toBe(chipsBefore - callAction.minAmount);
        expect(hasEvent(result.events, 'ACTION_APPLIED')).toBe(true);
      }
    });
  });

  describe('PLAYER_ACTION - raise', () => {
    it('レイズでストリートは変わらない', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;
      const validActions = getValidActions(state, seatIndex);
      const raiseAction = validActions.find(a => a.action === 'raise');

      if (raiseAction) {
        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: 'raise',
          amount: raiseAction.minAmount,
        });

        expect(result.state.currentStreet).toBe('preflop');
        expect(hasEvent(result.events, 'STREET_ADVANCED')).toBe(false);
      }
    });
  });

  describe('PLAYER_ACTION - street advancement', () => {
    it('全員コールでストリートが進むと STREET_ADVANCED イベントが発生する', () => {
      let state = createHandState();
      let streetAdvanced = false;

      // 全員コールし続ける
      for (let i = 0; i < 20 && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const callAction = validActions.find(a => a.action === 'call');
        const checkAction = validActions.find(a => a.action === 'check');

        const action = checkAction || callAction;
        if (!action) break;

        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: action.action,
          amount: action.minAmount,
        });

        if (hasEvent(result.events, 'STREET_ADVANCED')) {
          streetAdvanced = true;
          const event = findEvent(result.events, 'STREET_ADVANCED')!;
          expect(event.street).toBe('flop');
          expect(event.newCards).toHaveLength(3);
          break;
        }

        state = result.state;
      }

      expect(streetAdvanced).toBe(true);
    });
  });

  describe('PLAYER_ACTION - hand completion', () => {
    it('全員フォールドでハンドが完了し HAND_COMPLETED イベントが発生する', () => {
      let state = createHandState();

      // 5人フォールドして1人残す
      for (let i = 0; i < 5 && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: 'fold',
        });

        if (hasEvent(result.events, 'HAND_COMPLETED')) {
          const event = findEvent(result.events, 'HAND_COMPLETED')!;
          expect(event.winners).toHaveLength(1);
          expect(result.state.isHandComplete).toBe(true);
          return; // テスト成功
        }

        state = result.state;
      }

      // 最後の1回で完了するはず
      expect(state.isHandComplete).toBe(true);
    });
  });

  describe('PLAYER_ACTION - validation', () => {
    it('自分のターンでないプレイヤーのアクションは無視される', () => {
      const state = createHandState();
      const wrongSeat = (state.currentPlayerIndex + 1) % 6;

      const result = processCommand(state, {
        type: 'PLAYER_ACTION',
        seatIndex: wrongSeat,
        action: 'fold',
      });

      expect(result.events).toHaveLength(0);
      expect(result.state).toBe(state); // 状態が変わらない（同一参照）
    });

    it('無効なアクションは無視される', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;

      // プリフロップでは通常checkはできない（BBのみ）
      // currentPlayerIndex は UTG のはずなのでcheckは無効の可能性が高い
      const validActions = getValidActions(state, seatIndex);
      const canCheck = validActions.some(a => a.action === 'check');

      if (!canCheck) {
        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: 'check',
        });

        expect(result.events).toHaveLength(0);
      }
    });
  });

  describe('TIMEOUT', () => {
    it('チェック可能ならチェックする', () => {
      // フロップまで進めてチェック可能な状況を作る
      let state = createHandState();

      // 全員コールしてフロップへ
      for (let i = 0; i < 20 && state.currentStreet === 'preflop' && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const callAction = validActions.find(a => a.action === 'call');
        const checkAction = validActions.find(a => a.action === 'check');
        const action = checkAction || callAction;
        if (!action) break;

        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: action.action,
          amount: action.minAmount,
        });
        state = result.state;
      }

      if (state.currentStreet !== 'preflop' && !state.isHandComplete) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const canCheck = validActions.some(a => a.action === 'check');

        if (canCheck) {
          const result = processCommand(state, { type: 'TIMEOUT', seatIndex });

          const event = findEvent(result.events, 'ACTION_APPLIED');
          expect(event).toBeDefined();
          expect(event!.action).toBe('check');
        }
      }
    });

    it('チェック不可ならフォールドする', () => {
      const state = createHandState();
      const seatIndex = state.currentPlayerIndex;
      const validActions = getValidActions(state, seatIndex);
      const canCheck = validActions.some(a => a.action === 'check');

      if (!canCheck) {
        const result = processCommand(state, { type: 'TIMEOUT', seatIndex });

        const event = findEvent(result.events, 'ACTION_APPLIED');
        expect(event).toBeDefined();
        expect(event!.action).toBe('fold');
      }
    });
  });

  describe('PLAYER_ACTION - rake', () => {
    it('レーキオプション付きでハンド完了するとレーキが計算される', () => {
      let state = createHandState();

      // 全員フォールドして1人残す（プリフロップ完了 → レーキなし）
      // まずフロップまで進めてからフォールドさせる
      for (let i = 0; i < 20 && state.currentStreet === 'preflop' && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const callAction = validActions.find(a => a.action === 'call');
        const checkAction = validActions.find(a => a.action === 'check');
        const action = checkAction || callAction;
        if (!action) break;

        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: action.action,
          amount: action.minAmount,
        }, { rakePercent: 0.05, rakeCapBB: 1 });
        state = result.state;
      }

      // フロップ以降で全員フォールド
      if (!state.isHandComplete && state.currentStreet !== 'preflop') {
        for (let i = 0; i < 10 && !state.isHandComplete; i++) {
          const seatIndex = state.currentPlayerIndex;
          const result = processCommand(state, {
            type: 'PLAYER_ACTION',
            seatIndex,
            action: 'fold',
          }, { rakePercent: 0.05, rakeCapBB: 1 });

          if (hasEvent(result.events, 'HAND_COMPLETED')) {
            const event = findEvent(result.events, 'HAND_COMPLETED')!;
            expect(event.rake).toBeGreaterThanOrEqual(0);
            return; // テスト成功
          }

          state = result.state;
        }
      }
    });
  });

  describe('イベント順序', () => {
    it('ハンド完了時のイベント順序が正しい: ACTION_APPLIED → HAND_COMPLETED', () => {
      let state = createHandState();

      // 5人フォールドで完了させる
      for (let i = 0; i < 5 && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: 'fold',
        });

        if (hasEvent(result.events, 'HAND_COMPLETED')) {
          const actionIdx = result.events.findIndex(e => e.type === 'ACTION_APPLIED');
          const completeIdx = result.events.findIndex(e => e.type === 'HAND_COMPLETED');
          expect(actionIdx).toBeLessThan(completeIdx);
          return;
        }

        state = result.state;
      }
    });

    it('ストリート進行時のイベント順序が正しい: ACTION_APPLIED → STREET_ADVANCED', () => {
      let state = createHandState();

      for (let i = 0; i < 20 && !state.isHandComplete; i++) {
        const seatIndex = state.currentPlayerIndex;
        const validActions = getValidActions(state, seatIndex);
        const callAction = validActions.find(a => a.action === 'call');
        const checkAction = validActions.find(a => a.action === 'check');
        const action = checkAction || callAction;
        if (!action) break;

        const result = processCommand(state, {
          type: 'PLAYER_ACTION',
          seatIndex,
          action: action.action,
          amount: action.minAmount,
        });

        if (hasEvent(result.events, 'STREET_ADVANCED')) {
          const actionIdx = result.events.findIndex(e => e.type === 'ACTION_APPLIED');
          const streetIdx = result.events.findIndex(e => e.type === 'STREET_ADVANCED');
          expect(actionIdx).toBeLessThan(streetIdx);
          return;
        }

        state = result.state;
      }
    });
  });

  describe('状態の不変性', () => {
    it('processCommand は元の状態を変更しない', () => {
      const state = createHandState();
      const stateCopy = JSON.parse(JSON.stringify(state));
      const seatIndex = state.currentPlayerIndex;

      processCommand(state, {
        type: 'PLAYER_ACTION',
        seatIndex,
        action: 'fold',
      });

      // 元の状態が変更されていないことを確認
      expect(state.players[seatIndex].folded).toBe(stateCopy.players[seatIndex].folded);
      expect(state.pot).toBe(stateCopy.pot);
    });
  });
});
