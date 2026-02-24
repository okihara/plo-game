import { describe, it, expect } from 'vitest';
import { computeIncrementForPlayer } from '../statsComputation.js';

// 最小限のアクションエントリ
function action(seatIndex: number, odId: string, act: string, amount: number, street?: string) {
  return { seatIndex, odId, action: act, amount, street };
}

describe('computeIncrementForPlayer - allInEVProfit', () => {
  // 共通パラメータ
  const userId = 'user1';
  const userSeat = 0;
  const dealerPosition = 0;
  const activeSeatPositions = [0, 1, 2];
  const players = [
    { odId: 'user1', seatPosition: 0, finalHand: null },
    { odId: 'user2', seatPosition: 1, finalHand: null },
    { odId: 'user3', seatPosition: 2, finalHand: null },
  ];

  it('allInEVProfit が指定された場合、totalAllInEVProfit にその値が入る', () => {
    const actions = [action(0, 'user1', 'allin', 100, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, 200, actions,
      dealerPosition, ['user1'], activeSeatPositions, 5, players,
      150, // allInEVProfit: EVでは150の利益
    );

    expect(inc.totalAllInEVProfit).toBe(150);
    expect(inc.totalProfit).toBe(200); // 実利益は200
  });

  it('allInEVProfit が null の場合、実利益が totalAllInEVProfit に入る', () => {
    const actions = [action(0, 'user1', 'call', 50, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, -50, actions,
      dealerPosition, ['user2'], activeSeatPositions, 5, players,
      null, // オールインなし
    );

    expect(inc.totalAllInEVProfit).toBe(-50); // 実利益と同じ
    expect(inc.totalProfit).toBe(-50);
  });

  it('allInEVProfit が undefined の場合、実利益が totalAllInEVProfit に入る', () => {
    const actions = [action(0, 'user1', 'fold', 0, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, -10, actions,
      dealerPosition, ['user2'], activeSeatPositions, 0, players,
      // allInEVProfit 省略
    );

    expect(inc.totalAllInEVProfit).toBe(-10);
  });

  it('allInEVProfit が負の値（EV的に負けている）の場合', () => {
    const actions = [action(0, 'user1', 'allin', 100, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, 100, actions, // 実際には勝った
      dealerPosition, ['user1'], activeSeatPositions, 5, players,
      -30, // でもEV的には-30
    );

    expect(inc.totalProfit).toBe(100);
    expect(inc.totalAllInEVProfit).toBe(-30);
  });

  it('allInEVProfit = 0（EV的にブレイクイーブン）', () => {
    const actions = [action(0, 'user1', 'allin', 100, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, 50, actions,
      dealerPosition, ['user1'], activeSeatPositions, 5, players,
      0,
    );

    expect(inc.totalAllInEVProfit).toBe(0);
    expect(inc.totalProfit).toBe(50);
  });

  it('基本スタッツ（handsPlayed, winCount）は allInEVProfit に関係なく正しい', () => {
    const actions = [action(0, 'user1', 'allin', 100, 'preflop')];
    const inc = computeIncrementForPlayer(
      userId, userSeat, 200, actions,
      dealerPosition, ['user1'], activeSeatPositions, 5, players,
      150,
    );

    expect(inc.handsPlayed).toBe(1);
    expect(inc.winCount).toBe(1);
  });
});
