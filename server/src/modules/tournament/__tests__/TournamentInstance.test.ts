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

    it('バスト通知が個人・全体に送信される（レイト登録中はposition=null）', () => {
      // registrationLevels: 2 (デフォルト) → level 1 なのでレイト登録中
      const tournament = new TournamentInstance(io, createTestConfig());
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      // 個人通知 (tournament:eliminated) — レイト登録中はposition=null
      expect(sockets[2].emit).toHaveBeenCalledWith(
        'tournament:eliminated',
        expect.objectContaining({
          position: null,
          totalPlayers: 3,
        })
      );

      // 全体通知 (tournament:player_eliminated)
      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      const eliminatedCalls = roomEmit.mock.calls.filter(
        (args: unknown[]) => args[0] === 'tournament:player_eliminated'
      );
      expect(eliminatedCalls.length).toBeGreaterThan(0);

      // 全体通知もposition=null
      const eliminatedData = eliminatedCalls[0][1] as { position: number | null };
      expect(eliminatedData.position).toBeNull();
    });

    it('レイト登録締切後のバスト通知はpositionが数値で送信される', () => {
      // registrationLevels: 1 → level 1 で登録可、level 2 以降は締切
      const tournament = new TournamentInstance(io, createTestConfig({ registrationLevels: 1 }));
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      // 5分経過 → level 2 に進む（registrationLevels: 1 を超過）
      vi.advanceTimersByTime(5 * 60 * 1000);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      // 個人通知: 締切後なのでposition=3（数値）
      expect(sockets[2].emit).toHaveBeenCalledWith(
        'tournament:eliminated',
        expect.objectContaining({
          position: 3,
          totalPlayers: 3,
        })
      );

      // 全体通知も数値
      const roomEmit = (io.to as ReturnType<typeof vi.fn>).mock.results[0]?.value?.emit;
      const eliminatedCalls = roomEmit.mock.calls.filter(
        (args: unknown[]) => args[0] === 'tournament:player_eliminated'
      );
      expect(eliminatedCalls.length).toBeGreaterThan(0);
      const eliminatedData = eliminatedCalls[0][1] as { position: number | null };
      expect(eliminatedData.position).toBe(3);
    });

    it('レイト登録中の内部finishPositionは正しく保持される', () => {
      // レイト登録中でも内部順位は計算・保持される（トーナメント完了時に使うため）
      const tournament = new TournamentInstance(io, createTestConfig());
      startAndEnterNPlayers(tournament, 3);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      // 通知ではnullだが、内部のfinishPositionは正しい値を保持
      expect(tournament.getPlayer('player_2')?.finishPosition).toBe(3);
    });

    it('レイト登録境界: 締切レベルちょうどではまだ登録中', () => {
      // registrationLevels: 2 → level 2 まで登録可能
      const tournament = new TournamentInstance(io, createTestConfig({ registrationLevels: 2 }));
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      // 5分経過 → level 2（registrationLevels: 2 以内 → まだ登録中）
      vi.advanceTimersByTime(5 * 60 * 1000);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      expect(sockets[2].emit).toHaveBeenCalledWith(
        'tournament:eliminated',
        expect.objectContaining({ position: null })
      );
    });

    it('レイト登録境界: 締切レベルを1超えるとpositionが送信される', () => {
      // registrationLevels: 2 → level 3 で締切後
      const tournament = new TournamentInstance(io, createTestConfig({ registrationLevels: 2 }));
      const { sockets } = startAndEnterNPlayers(tournament, 3);

      // 10分経過 → level 3（registrationLevels: 2 を超過）
      vi.advanceTimersByTime(10 * 60 * 1000);

      simulateBust(tournament, 'player_2', 300);
      simulateHandSettled(tournament, [
        { odId: 'player_0', seatIndex: 0, chips: 2500 },
        { odId: 'player_1', seatIndex: 1, chips: 2000 },
      ]);

      expect(sockets[2].emit).toHaveBeenCalledWith(
        'tournament:eliminated',
        expect.objectContaining({ position: 3 })
      );
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
  // G-3. 切断中プレイヤーのテーブルバランシング
  // ============================================

  describe('切断中プレイヤーのテーブルバランシング', () => {
    it('切断中のプレイヤーもmovePlayerで移動される', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      startAndEnterNPlayers(tournament, 8);

      expect(tournament.getTableCount()).toBe(2);

      const tables = (tournament as any).tables as Map<string, any>;
      const tablePlayerMap = (tournament as any).tablePlayerMap as Map<string, Set<string>>;
      const tableEntries = Array.from(tables.entries()) as [string, any][];

      // テーブルAとBを取得
      const [tableAId] = tableEntries[0];
      const [tableBId] = tableEntries[1];
      const tableAPlayers = Array.from(tablePlayerMap.get(tableAId) ?? []);

      // テーブルAのプレイヤーを1人選んで切断する
      const disconnectedPlayer = tableAPlayers[0];
      tournament.handleDisconnect(disconnectedPlayer);

      const player = tournament.getPlayer(disconnectedPlayer);
      expect(player?.socket).toBeNull();
      expect(player?.status).toBe('disconnected');
      expect(player?.tableId).toBe(tableAId);

      // movePlayer を直接呼び出して切断中プレイヤーの移動をテスト
      const movePlayer = (tournament as any).movePlayer.bind(tournament);
      movePlayer(disconnectedPlayer, tableAId, tableBId);

      // 切断中プレイヤーがテーブルBに移動していることを確認
      const movedPlayer = tournament.getPlayer(disconnectedPlayer);
      expect(movedPlayer?.tableId).toBe(tableBId);
    });
  });

  // ============================================
  // G-4. テーブル移動のエッジケース
  // ============================================

  describe('テーブル移動のエッジケース', () => {
    /**
     * ヘルパー: 2テーブルトーナメントを作成し、テーブル情報を返す
     */
    function setup2Tables(ioRef: Server, playerCount = 8) {
      const tournament = new TournamentInstance(ioRef, createTestConfig({
        playersPerTable: 6,
        minPlayers: 2,
      }));
      const { odIds, sockets } = startAndEnterNPlayers(tournament, playerCount);

      const tables = (tournament as any).tables as Map<string, any>;
      const tablePlayerMap = (tournament as any).tablePlayerMap as Map<string, Set<string>>;
      const entries = Array.from(tables.entries()) as [string, any][];
      const [tableAId] = entries[0];
      const [tableBId] = entries[1];
      const tableAPlayers = Array.from(tablePlayerMap.get(tableAId) ?? []);
      const tableBPlayers = Array.from(tablePlayerMap.get(tableBId) ?? []);

      return { tournament, odIds, sockets, tables, tablePlayerMap, tableAId, tableBId, tableAPlayers, tableBPlayers };
    }

    it('バスト済みプレイヤーのpending moveはスキップされる', () => {
      const { tournament, tableAPlayers, tableAId, tableBId } = setup2Tables(io);

      const targetPlayer = tableAPlayers[0];

      // ペンディング移動をキューに追加
      const pendingMoves = (tournament as any).pendingMoves as any[];
      pendingMoves.push({
        odId: targetPlayer,
        fromTableId: tableAId,
        toTableId: tableBId,
      });

      // プレイヤーをバスト
      simulateBust(tournament, targetPlayer, 300);
      // onHandSettled 前に finalizeBustedPlayers を手動実行
      (tournament as any).finalizeBustedPlayers();

      const player = tournament.getPlayer(targetPlayer);
      expect(player?.status).toBe('eliminated');

      // executePendingMoves がエラーなく完了し、移動がスキップされること
      const executePendingMoves = (tournament as any).executePendingMoves.bind(tournament);
      expect(() => executePendingMoves()).not.toThrow();

      // プレイヤーはeliminatedのまま
      expect(tournament.getPlayer(targetPlayer)?.status).toBe('eliminated');
    });

    it('移動先テーブルが削除済みならpending moveはスキップされる', () => {
      const { tournament, tableAPlayers, tableAId, tableBId, tables, tablePlayerMap } = setup2Tables(io);

      const targetPlayer = tableAPlayers[0];

      // ペンディング移動をキュー（A→Bへの移動）
      const pendingMoves = (tournament as any).pendingMoves as any[];
      pendingMoves.push({
        odId: targetPlayer,
        fromTableId: tableAId,
        toTableId: tableBId,
      });

      // テーブルBを手動削除（全員バストした想定）
      tables.delete(tableBId);
      tablePlayerMap.delete(tableBId);

      // executePendingMoves がエラーなく完了し、移動がスキップされること
      const executePendingMoves = (tournament as any).executePendingMoves.bind(tournament);
      expect(() => executePendingMoves()).not.toThrow();

      // プレイヤーは元のテーブルAに残っている
      expect(tournament.getPlayer(targetPlayer)?.tableId).toBe(tableAId);
    });

    it('movePlayerで着席失敗時に元テーブルにリカバリされる', () => {
      const { tournament, tableAPlayers, tableAId, tableBId } = setup2Tables(io);

      const targetPlayer = tableAPlayers[0];

      // ハンドを停止（unseatPlayerが席を実際に解放するために必要）
      const tables = (tournament as any).tables as Map<string, any>;
      for (const table of tables.values()) {
        table._isHandInProgress = false;
        table.gameState = null;
      }

      // テーブルBの空席をすべて埋めて満席にする
      const tableB = tables.get(tableBId)!;
      while (tableB.hasAvailableSeat()) {
        const dummyId = `dummy_${Math.random().toString(36).slice(2)}`;
        tableB.seatPlayer(dummyId, 'Dummy', createMockSocket(), 1000);
      }

      // movePlayer を呼ぶ（着席失敗 → リカバリ）
      const movePlayer = (tournament as any).movePlayer.bind(tournament);
      movePlayer(targetPlayer, tableAId, tableBId);

      // プレイヤーは元テーブルAにリカバリされている
      const player = tournament.getPlayer(targetPlayer);
      expect(player?.tableId).toBe(tableAId);

      // tablePlayerMapもテーブルAで追跡されている
      const tablePlayerMap = (tournament as any).tablePlayerMap as Map<string, Set<string>>;
      expect(tablePlayerMap.get(tableAId)?.has(targetPlayer)).toBe(true);
      expect(tablePlayerMap.get(tableBId)?.has(targetPlayer)).toBeFalsy();
    });

    it('ハンド中テーブルからのmovePlayerは席をleftForFastFoldにする（席は解放されない）', () => {
      const { tournament, tableAPlayers, tableAId, tableBId } = setup2Tables(io);

      const targetPlayer = tableAPlayers[0];

      // テーブルAはハンド中（デフォルト状態）
      const tables = (tournament as any).tables as Map<string, any>;
      const tableA = tables.get(tableAId)!;
      expect(tableA.isHandInProgress).toBe(true);

      // テーブルBのハンドは完了
      const tableB = tables.get(tableBId)!;
      tableB._isHandInProgress = false;
      tableB.gameState = null;

      // ハンド中テーブルからmovePlayer → unseatPlayerが席を即解放しない
      const movePlayer = (tournament as any).movePlayer.bind(tournament);
      movePlayer(targetPlayer, tableAId, tableBId);

      // プレイヤーはテーブルBに移動できている（テーブルBに空席があるため）
      const player = tournament.getPlayer(targetPlayer);
      expect(player?.tableId).toBe(tableBId);
    });

    it('再接続したプレイヤーのpending moveが正しく実行される', () => {
      const { tournament, sockets, tableAPlayers, tableAId, tableBId } = setup2Tables(io);

      const targetPlayer = tableAPlayers[0];

      // 切断
      tournament.handleDisconnect(targetPlayer);
      expect(tournament.getPlayer(targetPlayer)?.socket).toBeNull();

      // ペンディング移動をキュー
      const pendingMoves = (tournament as any).pendingMoves as any[];
      pendingMoves.push({
        odId: targetPlayer,
        fromTableId: tableAId,
        toTableId: tableBId,
      });

      // 再接続
      const newSocket = createMockSocket();
      tournament.handleReconnect(targetPlayer, newSocket);
      expect(tournament.getPlayer(targetPlayer)?.socket).toBe(newSocket);

      // executePendingMoves — 再接続済みなので移動は実行される
      const tables = (tournament as any).tables as Map<string, any>;
      for (const table of tables.values()) {
        table._isHandInProgress = false;
      }
      const executePendingMoves = (tournament as any).executePendingMoves.bind(tournament);
      executePendingMoves();

      // 移動が成功し、新しいsocketに通知が送られている
      const player = tournament.getPlayer(targetPlayer);
      expect(player?.tableId).toBe(tableBId);
      expect(newSocket.emit).toHaveBeenCalledWith('tournament:table_move', expect.any(Object));
    });

    it('pendingFinalTable中のonHandSettledでファイナルテーブルが正しく形成される', () => {
      const { tournament, tableAPlayers, tableBPlayers } = setup2Tables(io, 10);

      // テーブルAから4人バスト → 残り6人（= PLAYERS_PER_TABLE）
      for (let i = 1; i < tableAPlayers.length; i++) {
        simulateBust(tournament, tableAPlayers[i], 300);
      }

      // pendingFinalTable を立てる
      // （通常は handlePhaseTransition → scheduleFormFinalTable で設定される）
      (tournament as any).pendingFinalTable = true;

      // onHandSettled を呼ぶ（pendingFinalTable処理 → formFinalTable → 1テーブルに統合）
      const remainingPlayers = [tableAPlayers[0], ...tableBPlayers];
      const seatChips = remainingPlayers.map((id, i) => ({
        odId: id, seatIndex: i, chips: 2000,
      }));
      simulateHandSettled(tournament, seatChips);

      // テーブルが1つになりファイナルテーブルが形成されている
      expect(tournament.getTableCount()).toBe(1);

      // 全残りプレイヤーが同一テーブルにいる
      const tableIds = new Set<string>();
      for (const odId of remainingPlayers) {
        const p = tournament.getPlayer(odId);
        if (p?.status === 'playing' && p.tableId) {
          tableIds.add(p.tableId);
        }
      }
      expect(tableIds.size).toBe(1);
    });

    it('checkAndExecuteBalanceで空テーブルが正しく削除される', () => {
      const { tournament, tableAPlayers, tableBPlayers, tableAId } = setup2Tables(io);

      // テーブルAの全員をバスト → テーブルAが空になる
      for (const odId of tableAPlayers) {
        simulateBust(tournament, odId, 300);
      }

      const seatChips = tableBPlayers.map((id, i) => ({
        odId: id, seatIndex: i, chips: 2000,
      }));
      simulateHandSettled(tournament, seatChips);

      // テーブルAが削除されている
      const tables = (tournament as any).tables as Map<string, any>;
      expect(tables.has(tableAId)).toBe(false);
      expect(tournament.getTableCount()).toBe(1);
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

// バグ候補再現: onHandSettled 内の checkAndExecuteBalance が
    // busted player（まだ status='playing', tablePlayerMap に存在, seat.chips=0）を
    // 0チップで別テーブルに移動してしまう
    it('バスト直後のバランス調整で busted player が0チップで他テーブルに移動しない', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        allowReentry: true,
        maxReentries: 2,
        startingChips: 1500,
        playersPerTable: 4,
        maxPlayers: 20,
      }));

      tournament.start();

      // 9人参加（バランサーが発動する人数構成を狙う）
      const odIds: string[] = [];
      for (let i = 0; i < 9; i++) {
        const odId = `player_${i}`;
        odIds.push(odId);
        tournament.enterPlayer(odId, `P${i}`, createMockSocket());
      }

      const tables = (tournament as any).tables as Map<string, any>;
      const tableIds = Array.from(tables.keys());
      expect(tableIds.length).toBeGreaterThanOrEqual(2);

      // オーバーウェイトなテーブル（プレイヤー多い方）を特定
      const tableInfos = tableIds.map(tid => ({
        tid,
        count: tables.get(tid).getPlayerCount(),
      })).sort((a, b) => b.count - a.count);
      const overweightTableId = tableInfos[0].tid;
      const overweightTable = tables.get(overweightTableId);

      // tablePlayerMap の最後のプレイヤー = バランサーが移動対象に選ぶプレイヤー
      const tablePlayerMap = (tournament as any).tablePlayerMap as Map<string, Set<string>>;
      const playerIds = Array.from(tablePlayerMap.get(overweightTableId)!);
      const victimOdId = playerIds[playerIds.length - 1];

      // victim がバスト直前の状態を作る:
      // 1. TableInstance 側 seat.chips = 0（finalizeHand L1077 が行う処理）
      const pm = (overweightTable as any).playerManager;
      const victimSeatIndex = pm.findSeatByOdId(victimOdId);
      pm.updateChips(victimSeatIndex, 0);

      // 2. gameState.isHandComplete=true（getPlayerChips が seat.chips を返すように）
      (overweightTable as any).gameState = {
        isHandComplete: true,
        players: Array(6).fill(null).map((_, i) => ({
          chips: i === victimSeatIndex ? 0 : 1500,
        })),
      };
      (overweightTable as any)._isHandInProgress = false;

      // 3. onHandSettled を発火（seatChips に victim の chips=0 を含める）
      const settledChips = playerIds.map(odId => {
        const si = pm.findSeatByOdId(odId);
        const chips = odId === victimOdId ? 0 : 1500;
        return { odId, seatIndex: si, chips };
      });
      (tournament as any).onHandSettled(settledChips);

      // ---- 検証: victim が別テーブルに 0チップで着席していないか ----
      const victimLocations: Array<{ tableId: string; seatChips: number }> = [];
      for (const [tid, t] of tables.entries()) {
        const tpm = (t as any).playerManager;
        const seats = tpm.getSeats();
        for (const s of seats) {
          if (s?.odId === victimOdId) {
            victimLocations.push({ tableId: tid, seatChips: s.chips });
          }
        }
      }

      const movedToOtherTableAtZero = victimLocations.filter(
        v => v.tableId !== overweightTableId && v.seatChips === 0
      );
      expect(movedToOtherTableAtZero).toHaveLength(0);
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

  // ============================================
  // リエントリー
  // ============================================

  describe('リエントリー', () => {
    function createReentryTournament(overrides?: Partial<TournamentConfig>) {
      return new TournamentInstance(io, createTestConfig({
        allowReentry: true,
        maxReentries: 1,
        reentryDeadlineLevel: 3,
        ...overrides,
      }));
    }

    it('canReenter: eliminatedプレイヤーがリエントリー可能', () => {
      const tournament = createReentryTournament();
      const { odIds } = startAndEnterNPlayers(tournament, 3);
      simulateBust(tournament, odIds[0], 100);

      expect(tournament.getPlayer(odIds[0])?.status).toBe('eliminated');
      expect(tournament.canReenter(odIds[0])).toBe(true);
    });

    it('canReenter: リエントリー上限に達したら不可', () => {
      const tournament = createReentryTournament({ maxReentries: 1 });
      const { odIds } = startAndEnterNPlayers(tournament, 3);

      // 1回目のバスト → リエントリー
      simulateBust(tournament, odIds[0], 100);
      expect(tournament.canReenter(odIds[0])).toBe(true);
      const socket = createMockSocket();
      const result = tournament.enterPlayer(odIds[0], 'Player 0', socket);
      expect(result.success).toBe(true);
      expect(tournament.getPlayer(odIds[0])?.reentryCount).toBe(1);

      // 2回目のバスト → リエントリー不可
      simulateBust(tournament, odIds[0], 100);
      expect(tournament.canReenter(odIds[0])).toBe(false);
    });

    it('canReenter: allowReentry=false なら不可', () => {
      const tournament = new TournamentInstance(io, createTestConfig({
        allowReentry: false,
      }));
      const { odIds } = startAndEnterNPlayers(tournament, 3);
      simulateBust(tournament, odIds[0], 100);

      expect(tournament.canReenter(odIds[0])).toBe(false);
    });

    it('canReenter: reentryDeadlineLevel を超えたら不可', () => {
      const tournament = createReentryTournament({ reentryDeadlineLevel: 1 });
      const { odIds } = startAndEnterNPlayers(tournament, 3);

      // レベル2に進める
      vi.advanceTimersByTime(5 * 60 * 1000);

      simulateBust(tournament, odIds[0], 100);
      expect(tournament.canReenter(odIds[0])).toBe(false);
    });

    it('canReenter: playingプレイヤーは不可', () => {
      const tournament = createReentryTournament();
      const { odIds } = startAndEnterNPlayers(tournament, 3);

      expect(tournament.getPlayer(odIds[0])?.status).toBe('playing');
      expect(tournament.canReenter(odIds[0])).toBe(false);
    });

    it('enterPlayer: eliminatedプレイヤーがリエントリーでチップ復活・テーブル着席', () => {
      const tournament = createReentryTournament();
      const { odIds } = startAndEnterNPlayers(tournament, 3);
      simulateBust(tournament, odIds[0], 100);

      const socket = createMockSocket();
      const result = tournament.enterPlayer(odIds[0], 'Player 0', socket);
      expect(result.success).toBe(true);

      const player = tournament.getPlayer(odIds[0])!;
      expect(player.status).toBe('playing');
      expect(player.chips).toBe(1500); // startingChips
      expect(player.reentryCount).toBe(1);
      expect(player.tableId).not.toBeNull();
    });

    it('enterPlayer: リエントリー上限に達したプレイヤーは拒否', () => {
      const tournament = createReentryTournament({ maxReentries: 1 });
      const { odIds } = startAndEnterNPlayers(tournament, 3);

      // 1回目: バスト → リエントリー成功
      simulateBust(tournament, odIds[0], 100);
      tournament.enterPlayer(odIds[0], 'Player 0', createMockSocket());

      // 2回目: バスト → リエントリー拒否
      simulateBust(tournament, odIds[0], 100);
      const result = tournament.enterPlayer(odIds[0], 'Player 0', createMockSocket());
      expect(result.success).toBe(false);
      expect(result.error).toContain('上限');
    });
  });

  // ============================================
  // チップ総量の保存則
  // ============================================

  describe('チップ総量の保存則', () => {
    it('優勝者のチップが参加人数×スターティングチップと一致する', () => {
      const startingChips = 1500;
      const numPlayers = 6;
      const tournament = new TournamentInstance(io, createTestConfig({
        startingChips,
        maxPlayers: 18,
      }));

      const { odIds } = startAndEnterNPlayers(tournament, numPlayers);
      const totalChips = numPlayers * startingChips; // 9000

      // プレイヤーを1人ずつ脱落させる（player_5 → player_1 の順）
      // 脱落者のチップは勝者 player_0 に集まる
      let winnerChips = startingChips;
      for (let i = numPlayers - 1; i >= 1; i--) {
        const loserChips = startingChips; // 各プレイヤーの初期チップ
        simulateBust(tournament, odIds[i], loserChips);
        winnerChips += loserChips;

        // 残りプレイヤーのチップ配分を構築
        const remainingSeatChips = [];
        for (let j = 0; j < i; j++) {
          if (j === 0) {
            remainingSeatChips.push({ odId: odIds[j], seatIndex: j, chips: winnerChips });
          } else {
            remainingSeatChips.push({ odId: odIds[j], seatIndex: j, chips: startingChips });
          }
        }
        simulateHandSettled(tournament, remainingSeatChips);
      }

      // 検証: トーナメントが完了していること
      expect(tournament.getStatus()).toBe('completed');

      // 検証: 優勝者のチップが参加人数×スターティングチップと一致
      const winner = tournament.getPlayer(odIds[0]);
      expect(winner).toBeDefined();
      expect(winner!.finishPosition).toBe(1);
      expect(winner!.chips).toBe(totalChips);
    });

    it('リエントリー込みでも優勝者のチップが総エントリー数×スターティングチップと一致する', () => {
      const startingChips = 1500;
      const tournament = new TournamentInstance(io, createTestConfig({
        startingChips,
        maxPlayers: 18,
        allowReentry: true,
        maxReentries: 2,
        reentryDeadlineLevel: 4,
      }));

      // 3人参加
      const { odIds } = startAndEnterNPlayers(tournament, 3);

      // player_2 がバスト → リエントリー（合計エントリー4回分）
      simulateBust(tournament, odIds[2], startingChips);
      simulateHandSettled(tournament, [
        { odId: odIds[0], seatIndex: 0, chips: startingChips * 2 },
        { odId: odIds[1], seatIndex: 1, chips: startingChips },
      ]);
      tournament.enterPlayer(odIds[2], 'Player 2', createMockSocket());

      const totalEntries = tournament.getTotalEntries(); // 4
      const totalChips = totalEntries * startingChips;   // 6000

      // player_2 再びバスト
      simulateBust(tournament, odIds[2], startingChips);
      simulateHandSettled(tournament, [
        { odId: odIds[0], seatIndex: 0, chips: startingChips * 3 },
        { odId: odIds[1], seatIndex: 1, chips: startingChips },
      ]);

      // player_1 バスト → player_0 が優勝
      simulateBust(tournament, odIds[1], startingChips);
      simulateHandSettled(tournament, [
        { odId: odIds[0], seatIndex: 0, chips: totalChips },
      ]);

      expect(tournament.getStatus()).toBe('completed');

      const winner = tournament.getPlayer(odIds[0]);
      expect(winner!.finishPosition).toBe(1);
      expect(winner!.chips).toBe(totalChips);
    });
  });
});
