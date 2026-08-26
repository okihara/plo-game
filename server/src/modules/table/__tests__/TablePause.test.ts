import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
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

/** ポーズ検証用: 作成者付きプライベート卓でハンドを1つ進行させる */
function setupPrivateHand(): {
  table: TableInstance;
  io: Server;
  odIds: string[];
  sockets: Socket[];
  seatMap: number[];
} {
  const io = createMockIO();
  const table = new TableInstance(io, '1/2', false, {
    isPrivate: true,
    inviteCode: 'ABCDE',
    ownerOdId: OWNER,
  });
  const { odIds, sockets, seatMap } = seatNPlayers(table, 3, 600);
  table.triggerMaybeStartHand();
  return { table, io, odIds, sockets, seatMap };
}

describe('コーチング用ポーズ', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('権限', () => {
    it('プライベート卓の作成者だけが操作できる', () => {
      const { table } = setupPrivateHand();

      expect(table.canControlPause(OWNER)).toBe(true);
      expect(table.canControlPause('player_1')).toBe(false);

      const rejected = table.resume('player_1');
      expect(rejected.ok).toBe(false);
      expect(table.pause('player_1').ok).toBe(false);
      expect(table.isPaused).toBe(false);

      expect(table.pause(OWNER).ok).toBe(true);
      expect(table.isPaused).toBe(true);
    });

    it('通常のキャッシュ卓ではポーズできない', () => {
      const io = createMockIO();
      const table = new TableInstance(io, '1/2');
      seatNPlayers(table, 3, 600);
      table.triggerMaybeStartHand();

      expect(table.canControlPause(OWNER)).toBe(false);
      expect(table.pause(OWNER).ok).toBe(false);
      expect(table.isPaused).toBe(false);
    });
  });

  describe('進行の停止', () => {
    it('ポーズ中はアクションが拒否され、再開すると通る', () => {
      const { table, odIds, sockets, seatMap } = setupPrivateHand();
      const current = findCurrentPlayer(table, odIds, sockets, seatMap)!;
      expect(current).not.toBeNull();

      table.pause(OWNER);
      expect(table.handleAction(current.odId, 'fold', 0)).toBe(false);
      // 手番は動いていない
      expect(table.getClientGameState().currentPlayerSeat).toBe(current.seatIndex);

      table.resume(OWNER);
      expect(table.handleAction(current.odId, 'fold', 0)).toBe(true);
    });

    it('ポーズ中はタイムアウトの自動フォールドが起きない', async () => {
      const { table, odIds, sockets, seatMap } = setupPrivateHand();
      const current = findCurrentPlayer(table, odIds, sockets, seatMap)!;

      table.pause(OWNER);
      await vi.advanceTimersByTimeAsync(TABLE_CONSTANTS.ACTION_TIMEOUT_PREFLOP_MS * 3);

      expect(table.getClientGameState().currentPlayerSeat).toBe(current.seatIndex);
    });

    it('再開すると残り時間でタイムアウトが復活する', async () => {
      const { table, odIds, sockets, seatMap } = setupPrivateHand();
      const current = findCurrentPlayer(table, odIds, sockets, seatMap)!;

      table.pause(OWNER);
      await vi.advanceTimersByTimeAsync(60_000);
      table.resume(OWNER);

      // 再開直後はまだ同じ手番
      expect(table.getClientGameState().currentPlayerSeat).toBe(current.seatIndex);

      // 残り時間（最大でもプリフロップ持ち時間）が経過すればタイムアウトで進む
      await vi.advanceTimersByTimeAsync(TABLE_CONSTANTS.ACTION_TIMEOUT_PREFLOP_MS + 1000);
      expect(table.getClientGameState().currentPlayerSeat).not.toBe(current.seatIndex);
    });

    it('ポーズが最大時間で自動解除される', async () => {
      const { table } = setupPrivateHand();

      table.pause(OWNER);
      expect(table.isPaused).toBe(true);

      await vi.advanceTimersByTimeAsync(TABLE_CONSTANTS.PAUSE_MAX_MS + 1000);
      expect(table.isPaused).toBe(false);
    });

    it('ポーズ中に離席が起きたら卓を凍らせ続けない', () => {
      const { table, odIds } = setupPrivateHand();

      table.pause(OWNER);
      table.unseatPlayer(odIds[1]);

      expect(table.isPaused).toBe(false);
    });
  });

  describe('クライアントへの通知', () => {
    it('ポーズ状態と操作権者が ClientGameState に乗る', () => {
      const { table } = setupPrivateHand();

      const before = table.getClientGameState();
      expect(before.isPaused).toBeUndefined();
      expect(before.pauseOwnerOdId).toBe(OWNER);

      table.pause(OWNER);
      const paused = table.getClientGameState();
      expect(paused.isPaused).toBe(true);
      expect(paused.pausedUntil).toBeGreaterThan(Date.now());
      // ポーズ中はカウントダウンを止める
      expect(paused.actionTimeoutAt).toBeNull();
    });

    it('通常卓にはポーズ関連のフィールドが乗らない', () => {
      const io = createMockIO();
      const table = new TableInstance(io, '1/2');
      seatNPlayers(table, 3, 600);
      table.triggerMaybeStartHand();

      const state = table.getClientGameState();
      expect(state.isPaused).toBeUndefined();
      expect(state.pauseOwnerOdId).toBeUndefined();
    });
  });
});
