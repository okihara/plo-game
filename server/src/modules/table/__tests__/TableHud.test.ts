// 卓内 HUD: プライベート卓でだけ、その卓で遊んだハンドから集計した VPIP/PFR/3Bet/ハンド数を配る
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TableInstance } from '../TableInstance.js';
import {
  createMockIO,
  seatNPlayers,
  findCurrentPlayer,
  resetSocketCounter,
} from './testHelpers.js';

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

function createTable(options: { isPrivate: boolean; isPractice?: boolean }): TableInstance {
  return new TableInstance(createMockIO(), '1/2', false, {
    isPrivate: options.isPrivate,
    isPractice: options.isPractice ?? false,
    ...(options.isPrivate ? { inviteCode: 'ABCDE', ownerOdId: 'player_0' } : {}),
  });
}

/** 先頭のプレイヤーはレイズ、残りはフォールドでハンドを終わらせる */
async function raiseThenFoldToCompletion(
  table: TableInstance,
  odIds: string[],
  sockets: ReturnType<typeof seatNPlayers>['sockets'],
  seatMap: number[]
): Promise<string> {
  const opener = findCurrentPlayer(table, odIds, sockets, seatMap)!;
  const raise = table.getValidActionsForSeat(opener.seatIndex).find(a => a.action === 'raise')!;
  table.handleAction(opener.odId, 'raise', raise.minAmount);
  for (let i = 0; i < 2; i++) {
    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    if (!current) break;
    table.handleAction(current.odId, 'fold', 0);
  }
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(2000);
  return opener.odId;
}

function hudByOdId(table: TableInstance) {
  return new Map(
    table
      .getClientGameState()
      .players.filter((p): p is NonNullable<typeof p> => p !== null)
      .map(p => [p.odId, p.hud])
  );
}

describe('卓内 HUD', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ハンド前は HUD を付けない', () => {
    const table = createTable({ isPrivate: true });
    seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    for (const hud of hudByOdId(table).values()) expect(hud).toBeUndefined();
  });

  it.each([
    { name: 'プライベート卓', isPractice: false },
    { name: '練習卓', isPractice: true },
  ])('$name ではハンド完了ごとに全員の HUD を集計する', async ({ isPractice }) => {
    const table = createTable({ isPrivate: true, isPractice });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    const opener = await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    const huds = hudByOdId(table);
    expect(huds.get(opener)).toMatchObject({ vpip: 100, pfr: 100, threeBet: 0 });
    for (const odId of odIds.filter(id => id !== opener)) {
      expect(huds.get(odId)).toMatchObject({ vpip: 0, pfr: 0 });
    }
  });

  it('公開卓では HUD を付けない', async () => {
    const table = createTable({ isPrivate: false });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    for (const hud of hudByOdId(table).values()) expect(hud).toBeUndefined();
  });
});
