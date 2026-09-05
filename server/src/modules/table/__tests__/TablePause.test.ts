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

/**
 * ポーズ検証用: 作成者付きプライベート卓に着席だけさせる。
 * ハンドはまだ始めていない = 手動ポーズを受け付けるハンドの切れ目。
 */
function setupPrivateTable(): {
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
  return { table, io, odIds, sockets, seatMap };
}

/** 上の卓でハンドを1つ進行させた状態 */
function setupPrivateHand(): ReturnType<typeof setupPrivateTable> {
  const ctx = setupPrivateTable();
  ctx.table.triggerMaybeStartHand();
  return ctx;
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
      const { table } = setupPrivateTable();

      expect(table.canControlCoaching(OWNER)).toBe(true);
      expect(table.canControlCoaching('player_1')).toBe(false);

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

      expect(table.canControlCoaching(OWNER)).toBe(false);
      expect(table.pause(OWNER).ok).toBe(false);
      expect(table.isPaused).toBe(false);
    });
  });

  describe('ポーズできるタイミング', () => {
    it('ハンド中は手番が宙吊りになるためポーズできない', () => {
      const { table } = setupPrivateHand();
      expect(table.isHandInProgress).toBe(true);

      const rejected = table.pause(OWNER);
      expect(rejected.ok).toBe(false);
      expect(table.isPaused).toBe(false);
    });

    it('ハンド中でもポーズ中なら再開できる（ハンドオープンの自動ポーズ解除用）', () => {
      const { table } = setupPrivateTable();
      table.pause(OWNER);

      expect(table.resume(OWNER).ok).toBe(true);
      expect(table.isPaused).toBe(false);
    });

    it('ハンドの切れ目ならポーズできる', () => {
      const { table } = setupPrivateTable();
      expect(table.isHandInProgress).toBe(false);

      expect(table.pause(OWNER).ok).toBe(true);
      expect(table.isPaused).toBe(true);
    });
  });

  describe('進行の停止', () => {
    it('ポーズ中は次のハンドが始まらない', () => {
      const { table } = setupPrivateTable();

      table.pause(OWNER);
      table.triggerMaybeStartHand();

      expect(table.isHandInProgress).toBe(false);
    });

    it('再開すると次のハンドが始まる', () => {
      const { table } = setupPrivateTable();

      table.pause(OWNER);
      table.triggerMaybeStartHand();
      expect(table.isHandInProgress).toBe(false);

      table.resume(OWNER);
      expect(table.isHandInProgress).toBe(true);
    });

    it('ハンド中のアクションはポーズの影響を受けずに通る', () => {
      const { table, odIds, sockets, seatMap } = setupPrivateHand();
      const current = findCurrentPlayer(table, odIds, sockets, seatMap)!;
      expect(current).not.toBeNull();

      // ハンド中はポーズが弾かれるので、手番はそのまま進められる
      expect(table.pause(OWNER).ok).toBe(false);
      expect(table.handleAction(current.odId, 'fold', 0)).toBe(true);
    });

    it('ポーズが最大時間で自動解除される', async () => {
      const { table } = setupPrivateTable();

      table.pause(OWNER);
      expect(table.isPaused).toBe(true);

      await vi.advanceTimersByTimeAsync(TABLE_CONSTANTS.PAUSE_MAX_MS + 1000);
      expect(table.isPaused).toBe(false);
    });

    it('ポーズ中に離席が起きたら卓を凍らせ続けない', () => {
      const { table, odIds } = setupPrivateTable();

      table.pause(OWNER);
      table.unseatPlayer(odIds[1]);

      expect(table.isPaused).toBe(false);
    });
  });

  describe('クライアントへの通知', () => {
    it('ポーズ状態と操作権者が ClientGameState に乗る', () => {
      const { table } = setupPrivateTable();

      const before = table.getClientGameState();
      expect(before.isPaused).toBeUndefined();
      expect(before.pauseOwnerOdId).toBe(OWNER);

      table.pause(OWNER);
      const paused = table.getClientGameState();
      expect(paused.isPaused).toBe(true);
      expect(paused.pausedUntil).toBeGreaterThan(Date.now());
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
