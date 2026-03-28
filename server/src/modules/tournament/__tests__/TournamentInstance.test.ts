import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { TournamentInstance } from '../TournamentInstance.js';
import { TournamentConfig, BlindLevel } from '../types.js';

// ============================================
// モック設定（TableInstance と同じ依存）
// ============================================

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

// ============================================
// テストヘルパー
// ============================================

const testBlindSchedule: BlindLevel[] = [
  { level: 1, smallBlind: 1, bigBlind: 2, ante: 0, durationMinutes: 5 },
  { level: 2, smallBlind: 2, bigBlind: 4, ante: 0, durationMinutes: 5 },
  { level: 3, smallBlind: 3, bigBlind: 6, ante: 0, durationMinutes: 5 },
];

function createTestConfig(overrides?: Partial<TournamentConfig>): TournamentConfig {
  return {
    id: 'test-tournament',
    name: 'Test Tournament',
    buyIn: 100,
    startingChips: 1500,
    minPlayers: 2,
    maxPlayers: 18,
    playersPerTable: 6,
    blindSchedule: testBlindSchedule,
    registrationLevels: 2,
    payoutPercentage: [],
    startCondition: 'manual',
    allowReentry: false,
    maxReentries: 0,
    reentryDeadlineLevel: 4,
    ...overrides,
  };
}

let socketCounter = 0;

function createMockIO(): Server {
  const roomEmit = vi.fn();
  const io = {
    to: vi.fn().mockReturnValue({ emit: roomEmit }),
    emit: vi.fn(),
  } as unknown as Server;
  return io;
}

function createMockSocket(id?: string): Socket {
  const socket = {
    id: id ?? `sock_${socketCounter++}`,
    connected: true,
    emit: vi.fn(),
    join: vi.fn(),
    leave: vi.fn(),
    on: vi.fn(),
  } as unknown as Socket;
  return socket;
}

/**
 * トーナメントを開始してからN人のプレイヤーを参加させるヘルパー。
 * 事前登録は廃止されたため、start() → enterPlayer() の順で呼ぶ。
 */
function startAndEnterNPlayers(
  tournament: TournamentInstance,
  n: number
): { odIds: string[]; sockets: Socket[] } {
  tournament.start();
  const odIds: string[] = [];
  const sockets: Socket[] = [];
  for (let i = 0; i < n; i++) {
    const odId = `player_${i}`;
    const socket = createMockSocket();
    tournament.enterPlayer(odId, `Player ${i}`, socket);
    odIds.push(odId);
    sockets.push(socket);
  }
  return { odIds, sockets };
}

/**
 * コールバック経由でバスト→ハンド完了をシミュレートするヘルパー。
 * TournamentInstance の private メソッド (onPlayerBusted / onHandSettled) を
 * テストから直接呼び出すことで、TableInstance を介さずにコアロジックを検証する。
 */
function simulateBust(
  tournament: TournamentInstance,
  odId: string,
  chipsAtHandStart: number
): void {
  const player = tournament.getPlayer(odId);
  if (player) {
    // onPlayerBusted 呼び出し前にチップを設定（実際はハンド開始時の値）
    player.chips = chipsAtHandStart;
  }
  const socket = player?.socket ?? null;
  (tournament as any).onPlayerBusted(odId, 0, socket);
}

function simulateHandSettled(
  tournament: TournamentInstance,
  seatChips: { odId: string; seatIndex: number; chips: number }[]
): void {
  // 実際の finalizeHand では _isHandInProgress = false が先に設定される。
  // テストでは手動で全テーブルのハンド中フラグをクリアしてから onHandSettled を呼ぶ。
  const tables = (tournament as any).tables as Map<string, any>;
  for (const table of tables.values()) {
    table._isHandInProgress = false;
  }
  (tournament as any).onHandSettled(seatChips);
}

// ============================================
// テスト
// ============================================

describe('TournamentInstance', () => {
  let io: Server;

  beforeEach(() => {
    vi.useFakeTimers();
    socketCounter = 0;
    io = createMockIO();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // A. 参加テスト
  // ============================================

  describe('参加', () => {
    it('running中にプレイヤーが参加できる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      tournament.start();
      const socket = createMockSocket();
      const result = tournament.enterPlayer('p1', 'Player 1', socket);

      expect(result.success).toBe(true);
      expect(tournament.getPlayerCount()).toBe(1);
      expect(tournament.getPrizePool()).toBe(100);
      expect(tournament.getPlayer('p1')?.status).toBe('playing');
      expect(tournament.getPlayer('p1')?.tableId).not.toBeNull();
    });

    it('開始時刻前は参加できない', () => {
      const futureTime = new Date(Date.now() + 60 * 60 * 1000); // 1時間後
      const tournament = new TournamentInstance(io, createTestConfig({ scheduledStartTime: futureTime }));
      const socket = createMockSocket();
      const result = tournament.enterPlayer('p1', 'Player 1', socket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('まだ開始されていません');
    });

    it('同一プレイヤーの二重参加を防ぐ', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      tournament.start();
      const socket = createMockSocket();
      tournament.enterPlayer('p1', 'Player 1', socket);
      const result = tournament.enterPlayer('p1', 'Player 1', socket);

      expect(result.success).toBe(false);
      expect(result.error).toContain('プレイ中');
    });

    it('定員に達すると参加できない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({ maxPlayers: 2 }));
      tournament.start();
      tournament.enterPlayer('p1', 'P1', createMockSocket());
      tournament.enterPlayer('p2', 'P2', createMockSocket());
      const result = tournament.enterPlayer('p3', 'P3', createMockSocket());

      expect(result.success).toBe(false);
      expect(result.error).toContain('定員');
    });
  });

  // ============================================
  // B. トーナメント開始テスト
  // ============================================

  describe('開始', () => {
    it('開始するとrunning状態になる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const result = tournament.start();

      expect(result.success).toBe(true);
      expect(tournament.getStatus()).toBe('running');
    });

    it('既に開始済みのトーナメントは再開始できない', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      tournament.start();
      const result = tournament.start();

      expect(result.success).toBe(false);
    });

    it('開始後にプレイヤーが参加するとテーブルが作成される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 4);

      expect(tournament.getTableCount()).toBeGreaterThanOrEqual(1);

      // 全プレイヤーがplaying状態でテーブルに着席済み
      for (let i = 0; i < 4; i++) {
        const player = tournament.getPlayer(`player_${i}`);
        expect(player?.status).toBe('playing');
        expect(player?.tableId).not.toBeNull();
      }
    });

    it('既に開始済みのトーナメントは再開始できない', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      const result = tournament.start();
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // C. 切断/再接続テスト
  // ============================================

  describe('切断/再接続', () => {
    it('切断でプレイヤーがdisconnected状態になる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.handleDisconnect('player_0');
      const player = tournament.getPlayer('player_0');
      expect(player?.status).toBe('disconnected');
      expect(player?.socket).toBeNull();
    });

    it('再接続でplaying状態に復帰する', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.handleDisconnect('player_0');
      const newSocket = createMockSocket('new_sock');
      const result = tournament.handleReconnect('player_0', newSocket);

      expect(result).toBe(true);
      const player = tournament.getPlayer('player_0');
      expect(player?.status).toBe('playing');
      expect(player?.socket).toBe(newSocket);
    });

    it('再接続で切断タイマーがクリアされる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.handleDisconnect('player_0');
      const newSocket = createMockSocket('new_sock');
      tournament.handleReconnect('player_0', newSocket);

      vi.advanceTimersByTime(3 * 60 * 1000);
      const player = tournament.getPlayer('player_0');
      expect(player?.status).toBe('playing');
    });

    it('再接続でトーナメントルームに再参加する', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.handleDisconnect('player_0');
      const newSocket = createMockSocket('new_sock');
      tournament.handleReconnect('player_0', newSocket);

      expect(newSocket.join).toHaveBeenCalledWith(`tournament:test-tournament`);
    });

    it('再接続でtournament:stateが送信される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.handleDisconnect('player_0');
      const newSocket = createMockSocket('new_sock');
      tournament.handleReconnect('player_0', newSocket);

      expect(newSocket.emit).toHaveBeenCalledWith(
        'tournament:state',
        expect.objectContaining({ tournamentId: 'test-tournament' })
      );
    });

    it('eliminated プレイヤーは再接続できない', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      // コールバック経由でeliminatedにする
      simulateBust(tournament, 'player_0', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2500 },
      ]);

      const newSocket = createMockSocket();
      const result = tournament.handleReconnect('player_0', newSocket);
      expect(result).toBe(false);
    });
  });

  // ============================================
  // D. プレイヤーバスト・順位計算テスト
  // ============================================

  describe('バスト順位計算', () => {
    it('1人バスト: 正しい順位が付与される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const { sockets } = startAndEnterNPlayers(tournament, 4);

      expect(tournament.getPlayersRemaining()).toBe(4);

      // player_3 がバスト（チップ300でハンド開始→バスト）
      simulateBust(tournament, 'player_3', 300);
      // ハンド完了（残り3人のチップ情報）
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      expect(tournament.getPlayersRemaining()).toBe(3);
      const busted = tournament.getPlayer('player_3');
      expect(busted?.status).toBe('eliminated');
      expect(busted?.finishPosition).toBe(4); // 4人中4位
    });

    it('連続バスト: 順位が正しくインクリメントされる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 4);

      // 1人目バスト: 4人→3人、順位4位
      simulateBust(tournament, 'player_3', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      expect(tournament.getPlayer('player_3')?.finishPosition).toBe(4);

      // 2人目バスト: 3人→2人、順位3位
      simulateBust(tournament, 'player_2', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 3000 },
      ]);

      expect(tournament.getPlayer('player_2')?.finishPosition).toBe(3);
    });

    it('同一ハンドで2人バスト: チップ多い方が上位', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 4);

      // 2人同時バスト: player_2(チップ500) と player_3(チップ300)
      simulateBust(tournament, 'player_2', 500);
      simulateBust(tournament, 'player_3', 300);

      // ハンド完了
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 3000 },
      ]);

      expect(tournament.getPlayersRemaining()).toBe(2);
      // player_2 はチップ多い（500）→ 3位
      expect(tournament.getPlayer('player_2')?.finishPosition).toBe(3);
      // player_3 はチップ少ない（300）→ 4位
      expect(tournament.getPlayer('player_3')?.finishPosition).toBe(4);
    });

    it('同一ハンドで同チップバスト: 同順位が付与される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 4);

      // 同チップ（400）で2人同時バスト
      simulateBust(tournament, 'player_2', 400);
      simulateBust(tournament, 'player_3', 400);

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 3000 },
      ]);

      // 同チップなので同順位
      expect(tournament.getPlayer('player_2')?.finishPosition).toBe(3);
      expect(tournament.getPlayer('player_3')?.finishPosition).toBe(3);
    });

    it('バスト通知が個人・全体に送信される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      // 個人通知 (tournament:eliminated)
      expect(sockets[2].emit).toHaveBeenCalledWith(
        'tournament:eliminated',
        expect.objectContaining({
          position: 3,
          totalPlayers: 3,
        })
      );

      // 全体通知 (tournament:player_eliminated)
      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      const eliminatedCalls = roomEmit.mock.calls.filter(
        (args: unknown[]) => args[0] === 'tournament:player_eliminated'
      );
      expect(eliminatedCalls.length).toBeGreaterThan(0);
    });

    it('onHandSettled でプレイヤーチップが同期される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      // バストなしでハンド完了
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2000 },
        { odId: 'player_1', seatIndex: 1, chips: 1000 },
        { odId: 'player_2', seatIndex: 2, chips: 1500 },
      ]);

      expect(tournament.getPlayer('player_0')?.chips).toBe(2000);
      expect(tournament.getPlayer('player_1')?.chips).toBe(1000);
      expect(tournament.getPlayer('player_2')?.chips).toBe(1500);
    });
  });

  // ============================================
  // E. フェーズ遷移テスト
  // ============================================

  describe('フェーズ遷移', () => {
    it('残り1人でトーナメント完了 (completed)', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const onComplete = vi.fn();
      tournament.onTournamentComplete = onComplete;
      startAndEnterNPlayers(tournament, 3);

      // 2人バスト → 残り1人
      simulateBust(tournament, 'player_1', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_2', seatIndex: 2, chips: 1500 },
      ]);

      simulateBust(tournament, 'player_2', 1500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 4500 },
      ]);

      expect(tournament.getStatus()).toBe('completed');
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('残り2人でheads_upに遷移', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      // 1人バスト → 残り2人
      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      expect(tournament.getStatus()).toBe('heads_up');
    });

    it('残りプレイヤーが多い場合はrunningのまま', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 5);

      // 1人バスト → 残り4人（playersPerTable=6 なのでfinal_tableにはならない）
      simulateBust(tournament, 'player_4', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 1500 },
        { odId: 'player_3', seatIndex: 3, chips: 2000 },
      ]);

      expect(tournament.getStatus()).toBe('running');
    });

    it('多テーブルで残りプレイヤーがplayersPerTable以下になるとfinal_tableへ遷移', () => {
      // 10人 → 2テーブル（5+5）
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      expect(tournament.getTableCount()).toBe(2);

      // 4人バスト → 残り6人 → playersPerTable(6)以下でfinal_table形成
      simulateBust(tournament, 'player_6', 300);
      simulateBust(tournament, 'player_7', 300);
      simulateBust(tournament, 'player_8', 300);
      simulateBust(tournament, 'player_9', 300);

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2500 },
        { odId: 'player_3', seatIndex: 3, chips: 3500 },
        { odId: 'player_4', seatIndex: 4, chips: 2000 },
        { odId: 'player_5', seatIndex: 5, chips: 2000 },
      ]);

      expect(tournament.getStatus()).toBe('final_table');
    });
  });

  // ============================================
  // F. トーナメント完了テスト
  // ============================================

  describe('トーナメント完了', () => {
    it('優勝者に1位が割り当てられる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const onComplete = vi.fn();
      tournament.onTournamentComplete = onComplete;
      startAndEnterNPlayers(tournament, 3);

      // player_1 バスト（3位）
      simulateBust(tournament, 'player_1', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_2', seatIndex: 2, chips: 1500 },
      ]);

      // player_2 バスト（2位）→ player_0 が優勝
      simulateBust(tournament, 'player_2', 1500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 4500 },
      ]);

      expect(tournament.getStatus()).toBe('completed');
      expect(tournament.getPlayer('player_0')?.finishPosition).toBe(1);
      expect(tournament.getPlayer('player_1')?.finishPosition).toBe(3);
      expect(tournament.getPlayer('player_2')?.finishPosition).toBe(2);
    });

    it('onTournamentComplete に結果配列が渡される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      const onComplete = vi.fn();
      tournament.onTournamentComplete = onComplete;
      startAndEnterNPlayers(tournament, 2);

      simulateBust(tournament, 'player_1', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
      ]);

      expect(onComplete).toHaveBeenCalledWith(
        'test-tournament',
        expect.arrayContaining([
          expect.objectContaining({ odId: 'player_0', position: 1 }),
          expect.objectContaining({ odId: 'player_1', position: 2 }),
        ])
      );
    });

    it('完了時にtournament:completedイベントが送信される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 2);

      simulateBust(tournament, 'player_1', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
      ]);

      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      const completedCalls = roomEmit.mock.calls.filter(
        (args: unknown[]) => args[0] === 'tournament:completed'
      );
      expect(completedCalls.length).toBeGreaterThan(0);
      expect(completedCalls[0][1]).toEqual(expect.objectContaining({
        totalPlayers: 2,
        prizePool: 200,
      }));
    });

    it('完了後にテーブルがクリアされる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 2);

      expect(tournament.getTableCount()).toBeGreaterThan(0);

      simulateBust(tournament, 'player_1', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
      ]);

      expect(tournament.getTableCount()).toBe(0);
    });
  });

  // ============================================
  // G. ファイナルテーブル形成テスト
  // ============================================

  describe('ファイナルテーブル形成', () => {
    it('テーブルが1つのみの場合はテーブル移動しない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({ playersPerTable: 6 }));
      startAndEnterNPlayers(tournament, 4);

      expect(tournament.getTableCount()).toBe(1);
      expect(tournament.getStatus()).toBe('running');
    });

    it('多テーブルで開始される', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      expect(tournament.getTableCount()).toBe(2);
    });

    it('ファイナルテーブル形成後は1テーブルになる', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      // 4人バスト → 残り6人
      for (let i = 6; i < 10; i++) {
        simulateBust(tournament, `player_${i}`, 300);
      }

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2500 },
        { odId: 'player_3', seatIndex: 3, chips: 3500 },
        { odId: 'player_4', seatIndex: 4, chips: 2000 },
        { odId: 'player_5', seatIndex: 5, chips: 2000 },
      ]);

      expect(tournament.getTableCount()).toBe(1);
      expect(tournament.getStatus()).toBe('final_table');

      // 全残りプレイヤーが同じテーブルにいる
      const tableIds = new Set<string>();
      for (let i = 0; i < 6; i++) {
        const player = tournament.getPlayer(`player_${i}`);
        if (player?.tableId) tableIds.add(player.tableId);
      }
      expect(tableIds.size).toBe(1);
    });

    it('ファイナルテーブル通知が送信される', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      for (let i = 6; i < 10; i++) {
        simulateBust(tournament, `player_${i}`, 300);
      }

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
        { odId: 'player_2', seatIndex: 2, chips: 2500 },
        { odId: 'player_3', seatIndex: 3, chips: 3500 },
        { odId: 'player_4', seatIndex: 4, chips: 2000 },
        { odId: 'player_5', seatIndex: 5, chips: 2000 },
      ]);

      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      const ftCalls = roomEmit.mock.calls.filter(
        (args: unknown[]) => args[0] === 'tournament:final_table'
      );
      expect(ftCalls.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // G-2. ヘッズアップでのハンド開始テスト
  // ============================================

  describe('ヘッズアップでのハンド開始', () => {
    it('ヘッズアップ（残り2人）でminPlayersToStartが2に設定される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      // 1人バスト → 残り2人 → heads_up
      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      expect(tournament.getStatus()).toBe('heads_up');

      // テーブルのminPlayersToStartが2に設定されている
      const tables = (tournament as any).tables as Map<string, any>;
      const table = tables.values().next().value;
      expect(table._minPlayersToStart).toBe(2);
    });

    it('多テーブルからヘッズアップ: ファイナルテーブル形成時にminPlayersToStartが2に設定される', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      expect(tournament.getTableCount()).toBe(2);

      // 8人バスト → 残り2人
      for (let i = 2; i < 10; i++) {
        simulateBust(tournament, `player_${i}`, 300);
      }

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 8000 },
        { odId: 'player_1', seatIndex: 1, chips: 7000 },
      ]);

      expect(tournament.getTableCount()).toBe(1);

      const tables = (tournament as any).tables as Map<string, any>;
      const table = tables.values().next().value;
      expect(table._minPlayersToStart).toBe(2);
    });

    it('3人以上残りの場合はminPlayersToStartが変更されない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 10);

      // 5人バスト → 残り5人 → final_table
      for (let i = 5; i < 10; i++) {
        simulateBust(tournament, `player_${i}`, 300);
      }

      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 3000 },
        { odId: 'player_1', seatIndex: 1, chips: 3000 },
        { odId: 'player_2', seatIndex: 2, chips: 3000 },
        { odId: 'player_3', seatIndex: 3, chips: 3000 },
        { odId: 'player_4', seatIndex: 4, chips: 3000 },
      ]);

      expect(tournament.getStatus()).toBe('final_table');

      const tables = (tournament as any).tables as Map<string, any>;
      const table = tables.values().next().value;
      expect(table._minPlayersToStart).toBeNull();
    });
  });

  // ============================================
  // H. リエントリーテスト
  // ============================================

  describe('リエントリー', () => {
    it('リエントリー不可のトーナメントでは失敗する', () => {
      const tournament = new TournamentInstance(io, createTestConfig({ allowReentry: false }));
      startAndEnterNPlayers(tournament, 3);

      // eliminated状態にしてからリエントリー試行
      simulateBust(tournament, 'player_0', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_1', seatIndex: 1, chips: 2500 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      const socket = createMockSocket();
      const result = tournament.enterPlayer('player_0', 'Player 0', socket);
      expect(result.success).toBe(false);
      expect(result.error).toContain('リエントリー不可');
    });

    it('eliminated状態でないとリエントリーできない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        allowReentry: true,
        maxReentries: 1,
      }));
      startAndEnterNPlayers(tournament, 3);

      const socket = createMockSocket();
      const result = tournament.enterPlayer('player_0', 'Player 0', socket);
      expect(result.success).toBe(false);
      expect(result.error).toContain('プレイ中');
    });

    it('リエントリー上限を超えると失敗する', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        allowReentry: true,
        maxReentries: 1,
      }));
      startAndEnterNPlayers(tournament, 3);

      // コールバック経由でeliminated状態にする
      simulateBust(tournament, 'player_0', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_1', seatIndex: 1, chips: 2500 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      // 1回目リエントリー
      const socket1 = createMockSocket();
      tournament.enterPlayer('player_0', 'Player 0', socket1);

      // 再度バスト → リエントリー2回目
      simulateBust(tournament, 'player_0', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_1', seatIndex: 1, chips: 3500 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      const socket2 = createMockSocket();
      const result = tournament.enterPlayer('player_0', 'Player 0', socket2);
      expect(result.success).toBe(false);
      expect(result.error).toContain('上限');
    });

    it('リエントリー成功でチップがリセットされプライズプールが増える', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        allowReentry: true,
        maxReentries: 2,
      }));
      startAndEnterNPlayers(tournament, 3);

      const poolBefore = tournament.getPrizePool();

      // コールバック経由でeliminated状態にする
      simulateBust(tournament, 'player_0', 500);
      simulateHandSettled(tournament, [
        { odId: 'player_1', seatIndex: 1, chips: 2500 },
        { odId: 'player_2', seatIndex: 2, chips: 2000 },
      ]);

      const socket = createMockSocket();
      const result = tournament.enterPlayer('player_0', 'Player 0', socket);

      expect(result.success).toBe(true);
      expect(tournament.getPrizePool()).toBe(poolBefore + 100);
      const updated = tournament.getPlayer('player_0');
      expect(updated?.chips).toBe(1500);
      expect(updated?.status).toBe('playing');
      expect(updated?.reentryCount).toBe(1);
    });
  });

  // ============================================
  // I. 登録期間テスト
  // ============================================

  describe('登録期間', () => {
    it('running状態で登録レベル内なら参加できる', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        registrationLevels: 2,
      }));
      startAndEnterNPlayers(tournament, 3);

      expect(tournament.isRegistrationOpen()).toBe(true);

      const socket = createMockSocket();
      const result = tournament.enterPlayer('late_player', 'Late Player', socket);
      expect(result.success).toBe(true);
      expect(tournament.getPlayerCount()).toBe(4);
    });

    it('登録期間を過ぎると参加できない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        registrationLevels: 1,
      }));
      startAndEnterNPlayers(tournament, 3);

      // レベル2へ進める（遅刻登録レベル=1を超える）
      vi.advanceTimersByTime(5 * 60 * 1000);

      expect(tournament.isRegistrationOpen()).toBe(false);

      const socket = createMockSocket();
      const result = tournament.enterPlayer('late_player', 'Late Player', socket);
      expect(result.success).toBe(false);
    });
  });

  // ============================================
  // J. クライアント状態テスト
  // ============================================

  describe('getClientState', () => {
    it('正しいクライアント状態を返す', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      const state = tournament.getClientState('player_0');

      expect(state.tournamentId).toBe('test-tournament');
      expect(state.name).toBe('Test Tournament');
      expect(state.status).toBe('running');
      expect(state.buyIn).toBe(100);
      expect(state.startingChips).toBe(1500);
      expect(state.prizePool).toBe(300);
      expect(state.totalPlayers).toBe(3);
      expect(state.playersRemaining).toBe(3);
      expect(state.myChips).toBe(1500);
      expect(state.myTableId).not.toBeNull();
      expect(state.averageStack).toBe(1500);
    });

    it('未登録プレイヤーの場合 myChips は null', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      const state = tournament.getClientState('unknown_player');
      expect(state.myChips).toBeNull();
      expect(state.myTableId).toBeNull();
    });
  });

  // ============================================
  // K. キャンセルテスト
  // ============================================

  describe('キャンセル', () => {
    it('キャンセルで全プレイヤーが離席しテーブルがクリアされる', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.cancel();

      expect(tournament.getStatus()).toBe('cancelled');
      expect(tournament.getTableCount()).toBe(0);
    });

    it('キャンセルでtournament:cancelledイベントが送信される', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      tournament.cancel();

      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      if (roomEmit) {
        const cancelledCalls = roomEmit.mock.calls.filter(
          (args: unknown[]) => args[0] === 'tournament:cancelled'
        );
        expect(cancelledCalls.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================
  // L. getLobbyInfo テスト
  // ============================================

  describe('getLobbyInfo', () => {
    it('ロビー表示用情報を返す', () => {
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      const info = tournament.getLobbyInfo();
      expect(info.id).toBe('test-tournament');
      expect(info.name).toBe('Test Tournament');
      expect(info.status).toBe('running');
      expect(info.registeredPlayers).toBe(3);
      expect(info.maxPlayers).toBe(18);
      expect(info.prizePool).toBe(300);
    });
  });
});
