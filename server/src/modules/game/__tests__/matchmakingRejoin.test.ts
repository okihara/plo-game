// matchmaking:join の幽霊紐付き自己修復のテスト。
// playerTables に紐付きだけ残って実座席がない状態（バスト直後の再参加など）でも、
// 紐付きを掃除して参加を続行できること。正常な「着席済みスキップ」は維持されること。

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Server } from 'socket.io';
import { TableManager } from '../../table/TableManager.js';
import { handleMatchmakingJoin } from '../handlers.js';
import { deductBuyIn } from '../../auth/bankroll.js';
import type { AuthenticatedSocket } from '../authMiddleware.js';

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: {
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../../config/database.js', () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'ghost',
        username: 'ghost',
        bankroll: { balance: 100000 },
      }),
    },
  },
}));

vi.mock('../../auth/bankroll.js', () => ({
  deductBuyIn: vi.fn().mockResolvedValue(true),
  cashOutPlayer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../profile/playerProfile.js', () => ({
  buildPlayerProfile: vi.fn().mockResolvedValue({ name: 'Ghost', avatarId: 0, avatarUrl: null }),
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

describe('handleMatchmakingJoin の幽霊紐付き自己修復', () => {
  let tm: TableManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    tm = new TableManager(io);
  });

  it('紐付きだけ残って席がない場合は掃除して参加できる', async () => {
    const table = tm.createTable('1/2');
    // バスト後に紐付きだけ残った幽霊状態を再現
    tm.setPlayerTable('ghost', table.id);
    expect(table.isPlayerSeated('ghost')).toBe(false);

    const socket = mockSocket('ghost');
    await handleMatchmakingJoin(socket, { blinds: '1/2' }, tm);

    // 参加が成立している
    expect(table.isPlayerSeated('ghost')).toBe(true);
    expect(tm.getPlayerTable('ghost')).toBe(table);
    expect(deductBuyIn).toHaveBeenCalledTimes(1);
  });

  it('実際に着席済みなら二重参加せずスキップする', async () => {
    const table = tm.createTable('1/2');
    const socket = mockSocket('ghost');

    // 1回目で正常に着席
    await handleMatchmakingJoin(socket, { blinds: '1/2' }, tm);
    expect(table.isPlayerSeated('ghost')).toBe(true);
    expect(deductBuyIn).toHaveBeenCalledTimes(1);

    // 2回目（再接続後の自動再投与など）はスキップ＝二重 buy-in しない
    await handleMatchmakingJoin(socket, { blinds: '1/2' }, tm);
    expect(deductBuyIn).toHaveBeenCalledTimes(1);
    expect(table.getPlayerCount()).toBe(1);
  });
});
