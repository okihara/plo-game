// トナメ卓 HUD: 全卓共有のトラッカーで読み、読み込みが終わったら本人が今いる卓に配信する
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Server, Socket } from 'socket.io';
import type { PlayerHudStats } from '@plo/shared';
import { TournamentInstance } from '../TournamentInstance.js';
import { TableInstance } from '../../table/TableInstance.js';
import { emptyHud } from '../../stats/hudStats.js';
import { loadTournamentHud } from '../../stats/hudLoader.js';
import type { TournamentConfig } from '../types.js';

vi.mock('../../../config/database.js', () => ({
  prisma: { handHistory: { create: vi.fn().mockResolvedValue({ id: 'test-hand-id' }) } },
}));

vi.mock('../../maintenance/MaintenanceService.js', () => ({
  maintenanceService: { isMaintenanceActive: vi.fn().mockReturnValue(false) },
}));

vi.mock('../../stats/updateStatsIncremental.js', () => ({
  updatePlayerStats: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../stats/hudLoader.js', () => ({
  loadPrivateHud: vi.fn(),
  loadTournamentHud: vi.fn(),
}));

const config: TournamentConfig = {
  id: 'test-tournament',
  name: 'Test Tournament',
  buyIn: 100,
  startingChips: 1500,
  minPlayers: 2,
  maxPlayers: 18,
  playersPerTable: 6,
  blindSchedule: [{ level: 1, smallBlind: 1, bigBlind: 2, ante: 0, durationMinutes: 5 }],
  registrationLevels: 1,
  payoutPercentage: [],
  startCondition: 'manual',
  allowReentry: false,
  maxReentries: 0,
  reentryDeadlineLevel: 1,
  gameVariant: 'plo',
};

function createMockIO(): Server {
  return { to: vi.fn().mockReturnValue({ emit: vi.fn() }), emit: vi.fn() } as unknown as Server;
}

function createMockSocket(id: string): Socket {
  return { id, connected: true, emit: vi.fn(), join: vi.fn(), leave: vi.fn(), on: vi.fn() } as unknown as Socket;
}

const flush = () => new Promise(r => setTimeout(r, 0));

describe('トナメ卓 HUD', () => {
  afterEach(() => vi.restoreAllMocks());

  it('読み込みが終わったら、本人が今いる卓に HUD 付きの状態を配信する', async () => {
    let resolveLoad!: (hud: PlayerHudStats) => void;
    vi.mocked(loadTournamentHud).mockReturnValue(new Promise(res => { resolveLoad = res; }));
    const broadcast = vi.spyOn(TableInstance.prototype, 'broadcastGameState');

    const tournament = new TournamentInstance(createMockIO(), config);
    tournament.start();
    tournament.enterPlayer('p0', 'Player 0', createMockSocket('s0'));
    const table = tournament.getTable(tournament.getPlayer('p0')!.tableId!)!;
    broadcast.mockClear();

    resolveLoad({ ...emptyHud(), hands: 10 });
    await flush();

    expect(loadTournamentHud).toHaveBeenCalledWith('p0', expect.any(Date));
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.contexts[0]).toBe(table);
    expect(table.getClientGameState().players.find(p => p?.odId === 'p0')?.hud?.hands).toBe(10);

    tournament.cancel();
  });
});
