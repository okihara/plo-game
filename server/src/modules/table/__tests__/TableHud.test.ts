// プライベート卓 HUD: プライベート卓でだけ、DB の累計にこの卓で遊んだハンドを足して配る
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TableInstance } from '../TableInstance.js';
import { emptyHud } from '../../stats/hudStats.js';
import { loadPrivateHud } from '../../stats/privateHud.js';
import { prisma } from '../../../config/database.js';
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

vi.mock('../../stats/privateHud.js', () => ({
  loadPrivateHud: vi.fn(),
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

/** DB にある累計（各プレイヤー共通） */
function dbHud(hands: number) {
  return { ...emptyHud(), hands, vpip: { n: hands, d: hands } };
}

describe('プライベート卓 HUD', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
    vi.mocked(loadPrivateHud).mockReset().mockResolvedValue(dbHud(0));
    vi.mocked(prisma.handHistory.create).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('累計 0 ハンドなら HUD を付けない', async () => {
    const table = createTable({ isPrivate: true });
    seatNPlayers(table, 3);
    await vi.advanceTimersByTimeAsync(0);

    for (const hud of hudByOdId(table).values()) expect(hud).toBeUndefined();
  });

  it('DB の累計にこの卓のハンドを足す', async () => {
    vi.mocked(loadPrivateHud).mockResolvedValue(dbHud(10));
    const table = createTable({ isPrivate: true });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(hudByOdId(table).get(odIds[0])?.hands).toBe(10);

    table.triggerMaybeStartHand();
    const opener = await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    expect(hudByOdId(table).get(opener)).toMatchObject({ hands: 11, vpip: { n: 11, d: 11 }, pfr: { n: 1, d: 1 } });
  });

  it.each([
    { name: 'プライベート卓', isPractice: false },
    { name: '練習卓', isPractice: true },
  ])('$name ではハンド完了ごとに全員の HUD を集計する', async ({ isPractice }) => {
    const table = createTable({ isPrivate: true, isPractice });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    await vi.advanceTimersByTimeAsync(0);
    table.triggerMaybeStartHand();

    const opener = await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    const huds = hudByOdId(table);
    expect(huds.get(opener)).toMatchObject({ hands: 1, vpip: { n: 1, d: 1 }, pfr: { n: 1, d: 1 } });
    for (const odId of odIds.filter(id => id !== opener)) {
      expect(huds.get(odId)).toMatchObject({ hands: 1, vpip: { n: 0, d: 1 }, pfr: { n: 0, d: 1 } });
    }
  });

  it('公開卓では HUD を付けない', async () => {
    const table = createTable({ isPrivate: false });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    for (const hud of hudByOdId(table).values()) expect(hud).toBeUndefined();
    expect(loadPrivateHud).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'プライベート卓', isPrivate: true, isPractice: false, expected: true },
    { name: '練習卓', isPrivate: true, isPractice: true, expected: true },
    { name: '公開卓', isPrivate: false, isPractice: false, expected: undefined },
  ])('$name のハンド履歴に isPrivate を記録する', async ({ isPrivate, isPractice, expected }) => {
    const table = createTable({ isPrivate, isPractice });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    await vi.advanceTimersByTimeAsync(0);
    table.triggerMaybeStartHand();

    await raiseThenFoldToCompletion(table, odIds, sockets, seatMap);

    const data = vi.mocked(prisma.handHistory.create).mock.calls[0][0].data;
    expect(data.isPrivate).toBe(expected);
  });
});
