// コーチング運用のためのプライベート卓の挙動:
//  - 作成者は席を外して観戦していてもポーズを操作できる
//  - 無人になっても即削除せず、TTL の間は招待コードのまま再集合できる

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'socket.io';
import { TableManager } from '../../table/TableManager.js';
import { TABLE_CONSTANTS } from '../../table/constants.js';
import { handleTablePause, handleTableResume, handleTableRevealHands } from '../handlers.js';
import type { AuthenticatedSocket } from '../authMiddleware.js';
import { createMockSocket, testSeatParams, resetSocketCounter } from '../../table/__tests__/testHelpers.js';

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: {
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../../config/database.js', () => ({
  prisma: {},
}));

function mockSocket(overrides: Partial<AuthenticatedSocket> = {}): AuthenticatedSocket {
  return {
    id: 's1',
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    odSpectatingTableId: null,
    ...overrides,
  } as unknown as AuthenticatedSocket;
}

describe('プライベート卓のコーチング動線', () => {
  let tm: TableManager;
  let io: Server;

  beforeEach(() => {
    resetSocketCounter();
    io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    tm = new TableManager(io);
  });

  describe('観戦中の作成者によるポーズ操作', () => {
    it('席を外して観戦中でも作成者はポーズ／再開できる', () => {
      const { table } = tm.createPrivateTable('1/2', 'coach');
      const socket = mockSocket({ odId: 'coach', odConnectionMode: 'spectate', odSpectatingTableId: table.id });

      handleTablePause(socket, tm);
      expect(table.isPaused).toBe(true);
      expect(socket.emit).not.toHaveBeenCalledWith('table:error', expect.anything());

      handleTableResume(socket, tm);
      expect(table.isPaused).toBe(false);
    });

    it('席を外して観戦中でも作成者はハンドオープンを切り替えられる', () => {
      const { table } = tm.createPrivateTable('1/2', 'coach');
      const socket = mockSocket({ odId: 'coach', odConnectionMode: 'spectate', odSpectatingTableId: table.id });

      handleTableRevealHands(socket, { enabled: true }, tm);
      expect(table.getClientGameState().revealAllHands).toBe(true);
      expect(socket.emit).not.toHaveBeenCalledWith('table:error', expect.anything());
    });

    it('作成者でない観戦者は操作できない', () => {
      const { table } = tm.createPrivateTable('1/2', 'coach');
      const socket = mockSocket({ odId: 'stranger', odConnectionMode: 'spectate', odSpectatingTableId: table.id });

      handleTablePause(socket, tm);
      expect(table.isPaused).toBe(false);
      expect(socket.emit).toHaveBeenCalledWith(
        'table:error',
        expect.objectContaining({ message: expect.stringMatching(/作成者/) })
      );
    });

    it('着席も観戦もしていなければテーブルを解決できない', () => {
      tm.createPrivateTable('1/2', 'coach');
      const socket = mockSocket({ odId: 'coach', odConnectionMode: 'spectate' });

      handleTablePause(socket, tm);
      expect(socket.emit).toHaveBeenCalledWith(
        'table:error',
        expect.objectContaining({ message: expect.stringMatching(/見つかりません/) })
      );
    });
  });

  describe('無人になったプライベート卓の寿命', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const seat = (tableId: string, odId: string) => {
      const table = tm.getTable(tableId)!;
      table.seatPlayer(testSeatParams(odId, odId, createMockSocket(), 200));
      tm.setPlayerTable(odId, table.id);
      tm.syncPrivateTableLifetime(table);
    };

    const unseat = (tableId: string, odId: string) => {
      const table = tm.getTable(tableId)!;
      table.unseatPlayer(odId);
      tm.removePlayerFromTracking(odId);
      tm.syncPrivateTableLifetime(table);
    };

    it('全員退出しても TTL の間は招待コードで戻れる', () => {
      const { table, inviteCode } = tm.createPrivateTable('1/2', 'coach');
      seat(table.id, 'coach');
      unseat(table.id, 'coach');

      vi.advanceTimersByTime(TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS - 1000);
      expect(tm.getTable(table.id)).toBeDefined();
      expect(tm.getTableByInviteCode(inviteCode)).toBe(table);
    });

    it('TTL を過ぎたら卓も招待コードも消える', () => {
      const { table, inviteCode } = tm.createPrivateTable('1/2', 'coach');
      seat(table.id, 'coach');
      unseat(table.id, 'coach');

      vi.advanceTimersByTime(TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS);
      expect(tm.getTable(table.id)).toBeUndefined();
      expect(tm.getTableByInviteCode(inviteCode)).toBeUndefined();
    });

    it('TTL 内に誰かが座り直したら削除予約は取り消される', () => {
      const { table } = tm.createPrivateTable('1/2', 'coach');
      seat(table.id, 'coach');
      unseat(table.id, 'coach');

      vi.advanceTimersByTime(TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS / 2);
      seat(table.id, 'student');

      vi.advanceTimersByTime(TABLE_CONSTANTS.PRIVATE_EMPTY_TTL_MS);
      expect(tm.getTable(table.id)).toBeDefined();
      expect(table.isPlayerSeated('student')).toBe(true);
    });
  });
});
