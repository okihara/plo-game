import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Server } from 'socket.io';
import { TableInstance } from '../TableInstance.js';
import {
  createMockIO,
  createMockSocket,
  seatNPlayers,
  findCurrentPlayer,
  getRoomEmits,
  resetSocketCounter,
  testSeatParams,
} from './testHelpers.js';

// ============================================
// モック設定（TableInstance.test.ts と同一）
// ============================================

vi.mock('../../../config/database.js', () => ({
  prisma: {
    handHistory: {
      create: vi.fn().mockResolvedValue({ id: 'test-hand-id' }),
    },
  },
}));

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: {
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../stats/updateStatsIncremental.js', () => ({
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/logic/equityCalculator.js', () => ({
  calculateAllInEVProfits: vi.fn().mockReturnValue(new Map()),
}));

// ============================================
// 9-max プライベート卓
// ============================================

describe('TableInstance - 9-max プライベート卓', () => {
  let io: Server;
  let table: TableInstance;

  beforeEach(() => {
    resetSocketCounter();
    io = createMockIO();
    table = new TableInstance(io, '1/3', false, {
      isPrivate: true,
      inviteCode: 'TEST9',
      ownerOdId: 'player_0',
      maxPlayers: 9,
    });
  });

  it('maxPlayers=9 が getTableInfo に反映される', () => {
    expect(table.maxPlayers).toBe(9);
    expect(table.getTableInfo().maxPlayers).toBe(9);
  });

  it('9人まで着席でき、10人目は null', () => {
    const { seatMap } = seatNPlayers(table, 9);
    expect(new Set(seatMap).size).toBe(9);
    expect(Math.max(...seatMap)).toBe(8);

    const extraSocket = createMockSocket();
    const seat = table.seatPlayer(testSeatParams('player_9', 'Player 9', extraSocket, 600));
    expect(seat).toBeNull();
  });

  it('9人着席でハンドが開始し、クライアント状態は9席分になる', () => {
    seatNPlayers(table, 9);
    table.triggerMaybeStartHand();

    const state = table.getClientGameState();
    expect(state.players).toHaveLength(9);
    expect(state.isHandInProgress).toBe(true);
  });

  it('7人（9席中）でハンドを全員フォールドで完走できる', async () => {
    vi.useFakeTimers();
    try {
      const { odIds, sockets, seatMap } = seatNPlayers(table, 7);
      table.triggerMaybeStartHand();

      expect(table.isHandInProgress).toBe(true);

      // BB 以外の6人がフォールドすればハンド完了
      for (let guard = 0; guard < 6; guard++) {
        const current = findCurrentPlayer(table, odIds, sockets, seatMap);
        if (!current) break;
        const result = table.handleAction(current.odId, 'fold', 0);
        expect(result).toBe(true);
      }

      // handleHandComplete の非同期遅延を進める
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      const handCompleteEmits = getRoomEmits(io, 'game:hand_complete');
      expect(handCompleteEmits.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('2人だけ着席でもハンドが開始する（プライベート卓の最小人数=2）', () => {
    seatNPlayers(table, 2);
    table.triggerMaybeStartHand();
    expect(table.isHandInProgress).toBe(true);
  });

  it('maxPlayers 未指定なら従来どおり6席', () => {
    const table6 = new TableInstance(io, '1/3', false, { isPrivate: true, inviteCode: 'TEST6', ownerOdId: 'x' });
    expect(table6.maxPlayers).toBe(6);
    const { seatMap } = seatNPlayers(table6, 6);
    expect(Math.max(...seatMap)).toBe(5);
    const extraSocket = createMockSocket();
    expect(table6.seatPlayer(testSeatParams('player_x', 'X', extraSocket, 600))).toBeNull();
  });
});
