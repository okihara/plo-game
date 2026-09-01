// 同一ユーザーの join が並行して届いたときに二重着席しないことのテスト。
//
// join 系ハンドラは「着席チェック → await（DB照会・バイイン控除）→ 着席」の流れなので、
// 直列化しないと2本とも着席チェックを素通りして同じ卓に2席取ってしまう。
// 一度二重に座ると playerTables（odId→tableId が1件）と unseatPlayer（1席のみ解放）の
// 構造上、片方の席が誰にも回収されない永久ゴーストになる。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server } from 'socket.io';
import { TableManager } from '../../table/TableManager.js';
import { handleMatchmakingJoin, handlePrivateJoin, handleTableLeave } from '../handlers.js';
import type { AuthenticatedSocket } from '../authMiddleware.js';

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: {
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../../config/database.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockImplementation(async () => {
        // DB 往復の非同期境界を再現する（ここで2本目の処理に制御が移る）
        await new Promise(resolve => setImmediate(resolve));
        return { id: 'u1', username: 'U1', bankroll: { balance: 100000 } };
      }),
    },
  },
}));

vi.mock('../../auth/bankroll.js', () => ({
  deductBuyIn: vi.fn().mockImplementation(async () => {
    await new Promise(resolve => setImmediate(resolve));
    return true;
  }),
  cashOutPlayer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../profile/playerProfile.js', () => ({
  buildPlayerProfile: vi.fn().mockResolvedValue({ name: 'U1', avatarId: 0, avatarUrl: null }),
}));

function mockSocket(odId: string): AuthenticatedSocket {
  return {
    id: `sock_${odId}`,
    odId,
    connected: true,
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
  } as unknown as AuthenticatedSocket;
}

/** 卓の実座席のうち、指定 odId が占めている数 */
function countSeats(table: { getAdminSeats: () => ({ odId: string } | null)[] }, odId: string): number {
  return table.getAdminSeats().filter(s => s?.odId === odId).length;
}

describe('同一ユーザーの並行 join', () => {
  let tm: TableManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    tm = new TableManager(io);
  });

  it('private:join が2本同時に来ても1席しか取らない', async () => {
    const { table, inviteCode } = tm.createPrivateTable('1/2', 'owner');
    const socket = mockSocket('u1');

    await Promise.all([
      handlePrivateJoin(socket, { inviteCode }, tm),
      handlePrivateJoin(socket, { inviteCode }, tm),
    ]);

    expect(countSeats(table, 'u1')).toBe(1);
  });

  it('matchmaking:join が2本同時に来ても1席しか取らない', async () => {
    const socket = mockSocket('u1');

    await Promise.all([
      handleMatchmakingJoin(socket, { blinds: '1/2' }, tm),
      handleMatchmakingJoin(socket, { blinds: '1/2' }, tm),
    ]);

    const table = tm.getPlayerTable('u1')!;
    expect(table).toBeDefined();
    expect(countSeats(table, 'u1')).toBe(1);
  });

  it('1席しか取っていないので table:leave で席が完全に空く', async () => {
    const { table, inviteCode } = tm.createPrivateTable('1/2', 'owner');
    const socket = mockSocket('u1');

    await Promise.all([
      handlePrivateJoin(socket, { inviteCode }, tm),
      handlePrivateJoin(socket, { inviteCode }, tm),
    ]);
    await handleTableLeave(socket, tm);

    expect(countSeats(table, 'u1')).toBe(0);
    expect(tm.getPlayerTable('u1')).toBeUndefined();
  });
});
