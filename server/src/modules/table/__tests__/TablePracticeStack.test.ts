// コーチング用の練習卓（毎ハンド 100BB に戻る卓）の挙動:
//  - ハンドが始まるたび全員のスタックが同額に戻る（勝ち分の持ち越しも負けの持ち越しもない）
//  - チップが尽きても席を失わない
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TableInstance } from '../TableInstance.js';
import { TABLE_CONSTANTS } from '../constants.js';
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

const OWNER = 'player_0';
const BB = 2;
/** 卓が毎ハンド配り直すスタック */
const PRACTICE_STACK = BB * TABLE_CONSTANTS.PRIVATE_BUYIN_BB;

function createTable(options: { isPractice: boolean }): TableInstance {
  return new TableInstance(createMockIO(), `1/${BB}`, false, {
    isPrivate: true,
    inviteCode: 'ABCDE',
    ownerOdId: OWNER,
    isPractice: options.isPractice,
  });
}

/** 全員フォールドでハンドを終わらせ、完了後の非同期処理まで進める */
async function foldToCompletion(
  table: TableInstance,
  odIds: string[],
  sockets: ReturnType<typeof seatNPlayers>['sockets'],
  seatMap: number[]
): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    if (!current) break;
    table.handleAction(current.odId, 'fold', 0);
  }
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(2000);
}

function chipsBySeat(table: TableInstance): number[] {
  return table
    .getAdminSeats()
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map(s => s.chips);
}

describe('練習卓（毎ハンド 100BB リセット）', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ハンド開始時に全員が同じスタックになる', () => {
    const table = createTable({ isPractice: true });
    // わざとバラバラのバイインで着席させる
    seatNPlayers(table, 3, 137);
    table.triggerMaybeStartHand();

    // ブラインドを引かれる前の持ち点が揃っている（配ったスタック = ポットに出た分 + 手元）
    const state = table.getClientGameState();
    const totalBySeat = state.players
      .filter(p => p !== null && !p.isSittingOut)
      .map(p => (p!.chips ?? 0) + (p!.currentBet ?? 0));
    expect(totalBySeat).toEqual([PRACTICE_STACK, PRACTICE_STACK, PRACTICE_STACK]);
  });

  it('前のハンドの勝ち負けを次のハンドに持ち越さない', async () => {
    const table = createTable({ isPractice: true });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3, PRACTICE_STACK);
    table.triggerMaybeStartHand();

    await foldToCompletion(table, odIds, sockets, seatMap);
    // フォールド決着でスタックに差がついている
    expect(new Set(chipsBySeat(table)).size).toBeGreaterThan(1);

    table.triggerMaybeStartHand();
    const state = table.getClientGameState();
    const totalBySeat = state.players
      .filter(p => p !== null && !p.isSittingOut)
      .map(p => (p!.chips ?? 0) + (p!.currentBet ?? 0));
    expect(totalBySeat).toEqual([PRACTICE_STACK, PRACTICE_STACK, PRACTICE_STACK]);
  });

  it('チップが尽きても席を失わない', async () => {
    const table = createTable({ isPractice: true });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3, PRACTICE_STACK);
    table.triggerMaybeStartHand();

    // 手番のプレイヤーを 0 まで削ってからハンドを終わらせる
    const current = findCurrentPlayer(table, odIds, sockets, seatMap)!;
    table.debugSetChips(current.odId, 0);
    await foldToCompletion(table, odIds, sockets, seatMap);

    expect(table.getPlayerCount()).toBe(3);
  });

  it('通常のプライベート卓はスタックを引き継ぐ', async () => {
    const table = createTable({ isPractice: false });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3, PRACTICE_STACK);
    table.triggerMaybeStartHand();

    await foldToCompletion(table, odIds, sockets, seatMap);
    const afterHand = chipsBySeat(table);
    expect(new Set(afterHand).size).toBeGreaterThan(1);

    table.triggerMaybeStartHand();
    const state = table.getClientGameState();
    const totalBySeat = state.players
      .filter(p => p !== null && !p.isSittingOut)
      .map(p => (p!.chips ?? 0) + (p!.currentBet ?? 0));
    expect(totalBySeat).not.toEqual([PRACTICE_STACK, PRACTICE_STACK, PRACTICE_STACK]);
  });

  it('練習卓のフラグが ClientGameState に乗る', () => {
    const practice = createTable({ isPractice: true });
    seatNPlayers(practice, 3, PRACTICE_STACK);
    expect(practice.getClientGameState().isPractice).toBe(true);

    const normal = createTable({ isPractice: false });
    seatNPlayers(normal, 3, PRACTICE_STACK);
    expect(normal.getClientGameState().isPractice).toBeUndefined();
  });
});
