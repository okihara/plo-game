import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'socket.io';
import { TournamentManager } from '../TournamentManager.js';
import { TournamentConfig, BlindLevel } from '../types.js';

// ============================================
// モック設定
// ============================================

vi.mock('../../../config/database.js', () => ({
  prisma: {
    handHistory: {
      create: vi.fn().mockResolvedValue({ id: 'test-hand-id' }),
    },
    $transaction: vi.fn().mockResolvedValue(undefined),
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

// ============================================
// ヘルパー
// ============================================

const testBlindSchedule: BlindLevel[] = [
  { level: 1, smallBlind: 1, bigBlind: 2, ante: 0, durationMinutes: 5 },
];

function createTestConfig(id: string): TournamentConfig {
  return {
    id,
    name: `Tournament ${id}`,
    buyIn: 100,
    startingChips: 1500,
    minPlayers: 2,
    maxPlayers: 18,
    playersPerTable: 6,
    blindSchedule: testBlindSchedule,
    lateRegistrationLevels: 2,
    payoutPercentage: [],
    startCondition: 'manual',
    allowReentry: false,
    maxReentries: 0,
    reentryDeadlineLevel: 4,
  };
}

function createMockIO(): Server {
  const roomEmit = vi.fn();
  return {
    to: vi.fn().mockReturnValue({ emit: roomEmit }),
    emit: vi.fn(),
  } as unknown as Server;
}

// ============================================
// テスト
// ============================================

describe('TournamentManager', () => {
  let io: Server;
  let manager: TournamentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    io = createMockIO();
    manager = new TournamentManager(io);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  it('トーナメントを作成できる', () => {
    const tournament = manager.createTournament(createTestConfig('t1'));
    expect(tournament).toBeDefined();
    expect(manager.getTournament('t1')).toBe(tournament);
  });

  it('存在しないトーナメントはundefinedを返す', () => {
    expect(manager.getTournament('nonexistent')).toBeUndefined();
  });

  it('プレイヤーのトーナメント関連付けを管理できる', () => {
    manager.setPlayerTournament('p1', 't1');
    expect(manager.getPlayerTournament('p1')).toBe('t1');

    manager.removePlayerFromTracking('p1');
    expect(manager.getPlayerTournament('p1')).toBeUndefined();
  });

  describe('getActiveTournaments', () => {
    it('完了・キャンセル以外のトーナメントを返す', () => {
      manager.createTournament(createTestConfig('t1'));
      manager.createTournament(createTestConfig('t2'));

      const active = manager.getActiveTournaments();
      expect(active).toHaveLength(2);
    });

    it('キャンセルされたトーナメントは含まない', () => {
      const t1 = manager.createTournament(createTestConfig('t1'));
      manager.createTournament(createTestConfig('t2'));

      t1.cancel();
      const active = manager.getActiveTournaments();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe('t2');
    });
  });

  describe('cleanupCompleted (#12)', () => {
    it('完了・キャンセル済みトーナメントをメモリから削除する', () => {
      manager.createTournament(createTestConfig('t1'));
      const t2 = manager.createTournament(createTestConfig('t2'));
      t2.cancel();

      expect(manager.getAllTournaments()).toHaveLength(2);

      manager.cleanupCompleted();

      expect(manager.getAllTournaments()).toHaveLength(1);
      expect(manager.getTournament('t1')).toBeDefined();
      expect(manager.getTournament('t2')).toBeUndefined();
    });

    it('進行中のトーナメントは削除しない', () => {
      manager.createTournament(createTestConfig('t1'));
      manager.cleanupCompleted();
      expect(manager.getAllTournaments()).toHaveLength(1);
    });
  });

  describe('onTournamentComplete コールバック', () => {
    it('トーナメント完了時にプレイヤートラッキングがクリアされる', () => {
      const tournament = manager.createTournament(createTestConfig('t1'));
      manager.setPlayerTournament('p1', 't1');
      manager.setPlayerTournament('p2', 't1');
      manager.setPlayerTournament('p3', 't2'); // 別トーナメント

      // onTournamentCompleteを手動で呼ぶ（結果データ付き）
      tournament.onTournamentComplete?.('t1', []);

      expect(manager.getPlayerTournament('p1')).toBeUndefined();
      expect(manager.getPlayerTournament('p2')).toBeUndefined();
      expect(manager.getPlayerTournament('p3')).toBe('t2'); // 他は影響なし
    });
  });
});
