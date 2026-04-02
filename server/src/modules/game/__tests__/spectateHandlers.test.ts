import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'socket.io';
import { TableManager } from '../../table/TableManager.js';
import { TournamentManager } from '../../tournament/TournamentManager.js';
import { handleSpectateJoin } from '../handlers.js';
import type { AuthenticatedSocket } from '../authMiddleware.js';

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: {
    isMaintenanceActive: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../config/database.js', () => ({
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

describe('handleSpectateJoin', () => {
  let tm: TableManager;
  let tr: TournamentManager;
  let io: Server;

  beforeEach(() => {
    io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as Server;
    tm = new TableManager(io);
    tr = new TournamentManager(io);
  });

  afterEach(() => {
    tr.destroy();
  });

  it('プライベート卓は招待コードなしで拒否', () => {
    const { table } = tm.createPrivateTable('1/2');
    const socket = mockSocket({ odConnectionMode: 'spectate', odId: 'u1' });
    handleSpectateJoin(socket, { tableId: table.id }, tm, tr);
    expect(socket.emit).toHaveBeenCalledWith(
      'table:error',
      expect.objectContaining({ message: expect.stringMatching(/招待/) })
    );
  });

  it('プライベート卓は正しい招待コードで spectate_joined する', () => {
    const { table, inviteCode } = tm.createPrivateTable('1/2');
    const socket = mockSocket({ odConnectionMode: 'spectate', odId: 'u1' });
    handleSpectateJoin(socket, { tableId: table.id, inviteCode }, tm, tr);
    expect(socket.emit).toHaveBeenCalledWith('table:spectate_joined', { tableId: table.id });
    expect(socket.emit).toHaveBeenCalledWith('game:state', expect.objectContaining({ state: expect.any(Object) }));
  });

  it('プレイ用接続モードでは拒否', () => {
    const { table } = tm.createPrivateTable('1/2');
    const socket = mockSocket({ odConnectionMode: 'play', odId: 'u1' });
    handleSpectateJoin(socket, { tableId: table.id }, tm, tr);
    expect(socket.emit).toHaveBeenCalledWith(
      'table:error',
      expect.objectContaining({ message: expect.stringMatching(/観戦用/) })
    );
  });
});
