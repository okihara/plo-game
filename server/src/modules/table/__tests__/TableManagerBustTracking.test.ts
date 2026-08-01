// バスト時に TableManager の playerTables 紐付きが解除されることのテスト。
// 解除されないと matchmaking:join が「着席済み」と誤判定し、バスト後の再参加が
// 「テーブルを検索中...」のまま止まる（幽霊紐付きバグ）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableManager } from '../TableManager.js';
import {
  createMockIO,
  seatNPlayers,
  findCurrentPlayer,
  getSocketEmits,
  resetSocketCounter,
} from './testHelpers.js';

describe('TableManager バスト時の紐付き解除', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('バストしたプレイヤーは table:busted 通知と共に playerTables から外れる', async () => {
    const io = createMockIO();
    const tm = new TableManager(io);
    const table = tm.createTable('1/2');

    const { odIds, sockets, seatMap } = seatNPlayers(table, 3, 600);
    for (const odId of odIds) {
      tm.setPlayerTable(odId, table.id);
    }
    table.triggerMaybeStartHand();

    // 最初の手番プレイヤーをチップ0にしてフォールドさせる（決定的にバストさせる）
    const target = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(target).not.toBeNull();
    table.debugSetChips(target!.odId, 0);
    table.handleAction(target!.odId, 'fold', 0);

    // 残り2人のうち1人がフォールドしてハンド終了
    const next = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(next).not.toBeNull();
    table.handleAction(next!.odId, 'fold', 0);

    // handleHandComplete の遅延（HAND_COMPLETE_DELAY → NEXT_HAND_DELAY）を進める
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // バスト通知と離席
    expect(getSocketEmits(target!.socket, 'table:busted')).toHaveLength(1);
    expect(table.isPlayerSeated(target!.odId)).toBe(false);

    // 紐付きが解除されている（これが残ると再参加できない）
    expect(tm.getPlayerTable(target!.odId)).toBeUndefined();

    // バストしていないプレイヤーの紐付きは維持される
    for (const odId of odIds) {
      if (odId === target!.odId) continue;
      expect(tm.getPlayerTable(odId)).toBe(table);
    }
  });
});
