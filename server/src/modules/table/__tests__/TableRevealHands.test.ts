import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { TableInstance } from '../TableInstance.js';
import {
  createMockIO,
  seatNPlayers,
  findCurrentPlayer,
  getRoomEmits,
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

type RevealPayload = { players: { seatIndex: number; cards: unknown[] }[] };

/** ハンドオープン検証用: 作成者付きプライベート卓でハンドを1つ進行させる */
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

/** 全員フォールドでハンドを終わらせ、完了時の非同期演出まで進める */
async function foldToCompletion(
  table: TableInstance,
  odIds: string[],
  sockets: Socket[],
  seatMap: number[]
): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();
    expect(table.handleAction(current!.odId, 'fold', 0)).toBe(true);
  }
  await vi.advanceTimersByTimeAsync(2000);
  await vi.advanceTimersByTimeAsync(2000);
}

describe('コーチング用ハンドオープン', () => {
  beforeEach(() => {
    resetSocketCounter();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('権限', () => {
    it('プライベート卓の作成者だけが切り替えられる', () => {
      const { table } = setupPrivateHand();

      expect(table.setRevealAllHands('player_1', true).ok).toBe(false);
      expect(table.getClientGameState().revealAllHands).toBeUndefined();

      expect(table.setRevealAllHands(OWNER, true).ok).toBe(true);
      expect(table.getClientGameState().revealAllHands).toBe(true);
    });

    it('通常のキャッシュ卓では切り替えられない', () => {
      const io = createMockIO();
      const table = new TableInstance(io, '1/2');
      seatNPlayers(table, 3, 600);
      table.triggerMaybeStartHand();

      expect(table.setRevealAllHands(OWNER, true).ok).toBe(false);
      expect(table.getClientGameState().revealAllHands).toBeUndefined();
    });
  });

  describe('公開のタイミング', () => {
    it('ON にしてもハンド進行中は公開しない', () => {
      const { table, io } = setupPrivateHand();

      table.setRevealAllHands(OWNER, true);

      expect(getRoomEmits(io, 'game:reveal_hands')).toHaveLength(0);
    });

    it('ハンド完了時にフォールド済みを含む全員のホールを公開する', async () => {
      const { table, io, odIds, sockets, seatMap } = setupPrivateHand();
      table.setRevealAllHands(OWNER, true);

      await foldToCompletion(table, odIds, sockets, seatMap);

      const emits = getRoomEmits(io, 'game:reveal_hands') as RevealPayload[];
      expect(emits.length).toBeGreaterThan(0);

      // 2人がフォールドして終わったハンドでも、着席3人全員のホールが乗る
      const revealed = emits[0].players;
      expect(revealed).toHaveLength(3);
      expect(new Set(revealed.map(p => p.seatIndex)).size).toBe(3);
      for (const p of revealed) {
        expect(p.cards).toHaveLength(4);
      }
    });

    it('OFF の卓ではハンドが完了しても公開しない', async () => {
      const { table, io, odIds, sockets, seatMap } = setupPrivateHand();

      await foldToCompletion(table, odIds, sockets, seatMap);

      expect(getRoomEmits(io, 'game:reveal_hands')).toHaveLength(0);
    });

    it('ハンド中に OFF に戻したらそのハンドは公開しない', async () => {
      const { table, io, odIds, sockets, seatMap } = setupPrivateHand();
      table.setRevealAllHands(OWNER, true);
      table.setRevealAllHands(OWNER, false);

      await foldToCompletion(table, odIds, sockets, seatMap);

      expect(getRoomEmits(io, 'game:reveal_hands')).toHaveLength(0);
    });
  });
});
