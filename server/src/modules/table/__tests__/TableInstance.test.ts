import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'socket.io';
import { TableInstance } from '../TableInstance.js';
import {
  createMockIO,
  createMockSocket,
  seatNPlayers,
  setupRunningHand,
  getSocketEmits,
  getRoomEmits,
  findCurrentPlayer,
  findBBPlayer,
  resetSocketCounter,
} from './testHelpers.js';

// ============================================
// モック設定
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

// ============================================
// A. 着席/離席テスト
// ============================================

describe('TableInstance - 着席/離席', () => {
  let io: Server;
  let table: TableInstance;

  beforeEach(() => {
    resetSocketCounter();
    io = createMockIO();
    table = new TableInstance(io, '1/2', false);
  });

  it('プレイヤーを着席させると席番号が返る', () => {
    const socket = createMockSocket();
    const seat = table.seatPlayer('user1', 'Alice', socket, 600);

    expect(seat).toBeTypeOf('number');
    expect(seat).toBeGreaterThanOrEqual(0);
    expect(seat).toBeLessThan(6);
  });

  it('着席後にsocket.joinとtable:joinedが呼ばれる', () => {
    const socket = createMockSocket();
    const seat = table.seatPlayer('user1', 'Alice', socket, 600);

    expect(socket.join).toHaveBeenCalledWith(`table:${table.id}`);
    const joinedEmits = getSocketEmits(socket, 'table:joined');
    expect(joinedEmits).toHaveLength(1);
    expect(joinedEmits[0]).toMatchObject({ tableId: table.id, seat });
  });

  it('着席後にgame:stateがブロードキャストされる', () => {
    const socket = createMockSocket();
    table.seatPlayer('user1', 'Alice', socket, 600);

    const stateEmits = getRoomEmits(io, 'game:state');
    expect(stateEmits.length).toBeGreaterThan(0);
  });

  it('skipJoinedEmit=trueでtable:joinedが送信されない', () => {
    const socket = createMockSocket();
    table.seatPlayer('user1', 'Alice', socket, 600, null, undefined, { skipJoinedEmit: true });

    const joinedEmits = getSocketEmits(socket, 'table:joined');
    expect(joinedEmits).toHaveLength(0);
  });

  it('preferredSeatで希望席に着席できる', () => {
    const socket = createMockSocket();
    const seat = table.seatPlayer('user1', 'Alice', socket, 600, null, 3);

    expect(seat).toBe(3);
  });

  it('6人着席後は満席でnullが返る', () => {
    seatNPlayers(table, 6);
    const socket = createMockSocket();
    const seat = table.seatPlayer('extra', 'Extra', socket, 600);

    expect(seat).toBeNull();
  });

  it('getPlayerCountが正しい値を返す', () => {
    expect(table.getPlayerCount()).toBe(0);
    seatNPlayers(table, 3);
    expect(table.getPlayerCount()).toBe(3);
  });

  it('hasAvailableSeatが正しい値を返す', () => {
    expect(table.hasAvailableSeat()).toBe(true);
    seatNPlayers(table, 6);
    expect(table.hasAvailableSeat()).toBe(false);
  });

  it('離席するとodIdとchipsが返る', () => {
    const socket = createMockSocket();
    table.seatPlayer('user1', 'Alice', socket, 600);

    const result = table.unseatPlayer('user1');
    expect(result).toMatchObject({ odId: 'user1', chips: 600 });
  });

  it('離席後にtable:leftとsocket.leaveが呼ばれる', () => {
    const socket = createMockSocket();
    table.seatPlayer('user1', 'Alice', socket, 600);
    table.unseatPlayer('user1');

    expect(socket.leave).toHaveBeenCalledWith(`table:${table.id}`);
    const leftEmits = getSocketEmits(socket, 'table:left');
    expect(leftEmits).toHaveLength(1);
  });

  it('存在しないプレイヤーの離席はnull', () => {
    const result = table.unseatPlayer('nonexistent');
    expect(result).toBeNull();
  });

  it('getTableInfoが正しいテーブル情報を返す', () => {
    seatNPlayers(table, 2);
    const info = table.getTableInfo();

    expect(info).toMatchObject({
      id: table.id,
      blinds: '1/2',
      players: 2,
      maxPlayers: 6,
      isFastFold: false,
    });
  });
});

// ============================================
// B. ハンド開始テスト
// ============================================

describe('TableInstance - ハンド開始', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('3人着席でハンドが開始される', () => {
    const { table, sockets } = setupRunningHand({ playerCount: 3 });

    expect(table.isHandInProgress).toBe(true);

    // 各プレイヤーにホールカード（4枚）が配布される
    for (const socket of sockets) {
      const holeCardEmits = getSocketEmits(socket, 'game:hole_cards');
      expect(holeCardEmits.length).toBeGreaterThanOrEqual(1);
      const lastEmit = holeCardEmits[holeCardEmits.length - 1] as { cards: unknown[] };
      expect(lastEmit.cards).toHaveLength(4);
    }
  });

  it('2人では通常テーブルのハンドが開始されない', () => {
    const io = createMockIO();
    const table = new TableInstance(io, '1/2', false);
    seatNPlayers(table, 2);
    table.triggerMaybeStartHand();

    expect(table.isHandInProgress).toBe(false);
  });

  it('FastFoldテーブルでは6人揃わないとハンドが開始されない', () => {
    const io = createMockIO();
    const table = new TableInstance(io, '1/2', true);
    seatNPlayers(table, 5);
    table.triggerMaybeStartHand();

    expect(table.isHandInProgress).toBe(false);
  });

  it('FastFoldテーブルで6人揃うとハンドが開始される', () => {
    const io = createMockIO();
    const table = new TableInstance(io, '1/2', true);
    seatNPlayers(table, 6);
    table.triggerMaybeStartHand();

    expect(table.isHandInProgress).toBe(true);
  });

  it('メンテナンスモード中はハンドが開始されない', async () => {
    const { maintenanceService } = await import('../../maintenance/MaintenanceService.js');
    vi.mocked(maintenanceService.isMaintenanceActive).mockReturnValue(true);

    const io = createMockIO();
    const table = new TableInstance(io, '1/2', false);
    seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    expect(table.isHandInProgress).toBe(false);

    vi.mocked(maintenanceService.isMaintenanceActive).mockReturnValue(false);
  });

  it('既にハンド中なら二重開始しない', () => {
    const { table } = setupRunningHand({ playerCount: 3 });

    table.triggerMaybeStartHand();
    expect(table.isHandInProgress).toBe(true);
  });

  it('ブラインドが投稿されてpotが正しい', () => {
    const { table } = setupRunningHand({ playerCount: 3, blinds: '1/2' });
    const state = table.getClientGameState();

    // SB(1) + BB(2) = 3
    expect(state.pot).toBe(3);
  });

  it('getClientGameStateでハンド状態が取得できる', () => {
    const { table } = setupRunningHand({ playerCount: 3, blinds: '1/2' });
    const state = table.getClientGameState();

    expect(state.isHandInProgress).toBe(true);
    expect(state.currentStreet).toBe('preflop');
    expect(state.smallBlind).toBe(1);
    expect(state.bigBlind).toBe(2);
  });
});

// ============================================
// C. アクション処理テスト
// ============================================

describe('TableInstance - アクション処理', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('gameStateがnullの時はアクションが拒否される', () => {
    const io = createMockIO();
    const table = new TableInstance(io, '1/2', false);
    seatNPlayers(table, 3);

    const result = table.handleAction('player_0', 'fold', 0);
    expect(result).toBe(false);
  });

  it('現在のプレイヤーのfoldが受理される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3 });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    const result = table.handleAction(current!.odId, 'fold', 0);
    expect(result).toBe(true);
  });

  it('自分のターンでないプレイヤーのアクションは拒否される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3 });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    const nonCurrentOdId = odIds.find(id => id !== current!.odId)!;

    const result = table.handleAction(nonCurrentOdId, 'fold', 0);
    expect(result).toBe(false);
  });

  it('foldの後に次のプレイヤーに手番が移る', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3 });

    const first = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(first).not.toBeNull();

    table.handleAction(first!.odId, 'fold', 0);

    const second = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(second).not.toBeNull();
    expect(second!.odId).not.toBe(first!.odId);
  });

  it('callが受理される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    const result = table.handleAction(current!.odId, 'call', 2);
    expect(result).toBe(true);
  });

  it('raiseが受理される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // action_required から有効アクションを取得
    const actionEmits = getSocketEmits(current!.socket, 'game:action_required');
    const lastAction = actionEmits[actionEmits.length - 1] as {
      validActions: { action: string; minAmount: number; maxAmount: number }[];
    };
    const raiseInfo = lastAction.validActions.find(a => a.action === 'raise');
    if (raiseInfo) {
      const result = table.handleAction(current!.odId, 'raise', raiseInfo.minAmount);
      expect(result).toBe(true);
    }
  });

  it('全員foldでハンドが完了する', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    // 2人がフォールドすれば残り1人が勝者
    for (let i = 0; i < 2; i++) {
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();
      const result = table.handleAction(current!.odId, 'fold', 0);
      expect(result).toBe(true);
    }

    // handleHandComplete の非同期遅延を進める
    // HAND_COMPLETE_DELAY_MS (2000) + NEXT_HAND_DELAY_MS (2000)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // game:hand_complete がブロードキャストされる
    const handCompleteEmits = getRoomEmits(io, 'game:hand_complete');
    expect(handCompleteEmits.length).toBeGreaterThan(0);

    const lastComplete = handCompleteEmits[handCompleteEmits.length - 1] as {
      winners: { playerId: string; amount: number }[];
    };
    expect(lastComplete.winners).toHaveLength(1);
    expect(lastComplete.winners[0].amount).toBeGreaterThan(0);
  });

  it('全員fold後に次のハンドが自動開始される', async () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    // 2人がフォールド
    for (let i = 0; i < 2; i++) {
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();
      table.handleAction(current!.odId, 'fold', 0);
    }

    // 全遅延を進める: HAND_COMPLETE_DELAY(2s) + NEXT_HAND_DELAY(2s) + 余裕
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(500);

    // 次のハンドが開始されている
    expect(table.isHandInProgress).toBe(true);
    const state = table.getClientGameState();
    expect(state.currentStreet).toBe('preflop');
  });
});

// ============================================
// D. タイムアウトテスト
// ============================================

describe('TableInstance - タイムアウト', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('20秒経過でアクションが自動実行される', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 何もアクションしないまま20秒経過
    vi.advanceTimersByTime(20000);

    // game:action_taken がブロードキャストされる
    const actionTakenEmits = getRoomEmits(io, 'game:action_taken');
    expect(actionTakenEmits.length).toBeGreaterThan(0);

    const lastAction = actionTakenEmits[actionTakenEmits.length - 1] as {
      playerId: string;
      action: string;
    };
    expect(lastAction.playerId).toBe(current!.odId);
    expect(['fold', 'check']).toContain(lastAction.action);
  });

  it('正規アクション後にタイムアウトが発火しない', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const first = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(first).not.toBeNull();

    // 正規アクション
    table.handleAction(first!.odId, 'fold', 0);
    const actionsAfterFold = getRoomEmits(io, 'game:action_taken').length;

    // 次のプレイヤーも即アクション
    const second = findCurrentPlayer(table, odIds, sockets, seatMap);
    if (second) {
      table.handleAction(second.odId, 'fold', 0);
    }
    const actionsAfterSecondFold = getRoomEmits(io, 'game:action_taken').length;

    // handleHandComplete の非同期処理が動く前にタイマーを少し進める
    // 旧タイムアウトが発火しないことを確認
    vi.advanceTimersByTime(20000);
    const actionsAfterTimeout = getRoomEmits(io, 'game:action_taken').length;

    // 2人fold → ハンド完了 → 余分なアクションは発生しない
    expect(actionsAfterTimeout).toBe(actionsAfterSecondFold);
  });
});

// ============================================
// E. FastFold テスト
// ============================================

describe('TableInstance - FastFold', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // --- handleEarlyFold ---

  describe('handleEarlyFold', () => {
    it('自分のターンでなければ保留されてtrueを返す', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();

      // 手番でないプレイヤーを探す
      const nonCurrent = odIds.find(id => id !== current!.odId)!;

      const result = table.handleEarlyFold(nonCurrent);
      expect(result).toBe(true);
    });

    it('保留フォールドは手番が回ってきた時に処理される', () => {
      const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();

      // 手番でないプレイヤーを1人earlyFold
      const nonCurrentIdx = odIds.findIndex(id => id !== current!.odId);
      table.handleEarlyFold(odIds[nonCurrentIdx]);

      // 手番が回るまで他のプレイヤーがアクション
      // earlyFoldしたプレイヤーの手番が来たら自動foldされるはず
      let safety = 10;
      while (safety-- > 0) {
        const cur = findCurrentPlayer(table, odIds, sockets, seatMap);
        if (!cur) break;
        if (cur.odId === odIds[nonCurrentIdx]) {
          // earlyFold済みなのにまだ手番にいるのはおかしい → 自動処理されたはず
          // ここには来ないはず
          break;
        }
        table.handleAction(cur.odId, 'fold', 0);
      }

      // earlyFoldしたプレイヤーのアクションがfoldとしてブロードキャストされている
      const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
      const earlyFoldAction = actions.find(a => a.playerId === odIds[nonCurrentIdx]);
      expect(earlyFoldAction).toBeDefined();
      expect(earlyFoldAction!.action).toBe('fold');
    });

    it('自分のターンなら即座にフォールドされる', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();

      const result = table.handleEarlyFold(current!.odId);
      expect(result).toBe(true);

      // 手番が次のプレイヤーに移っている
      const next = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(next).not.toBeNull();
      expect(next!.odId).not.toBe(current!.odId);
    });

    it('BBはプリフロップでFastFoldできない', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const bb = findBBPlayer(table, odIds, sockets, seatMap);
      expect(bb).not.toBeNull();

      // プリフロップ中
      expect(table.getClientGameState().currentStreet).toBe('preflop');

      const result = table.handleEarlyFold(bb!.odId);
      expect(result).toBe(false);
    });

    it('既にフォールド済みのプレイヤーはfalseを返す', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();

      // 正規foldする
      table.handleAction(current!.odId, 'fold', 0);

      // 既にfold済みなのでearlyFoldも失敗する
      const result = table.handleEarlyFold(current!.odId);
      expect(result).toBe(false);
    });

    it('ハンド未開始ではfalseを返す', () => {
      const io = createMockIO();
      const table = new TableInstance(io, '1/2', true);
      seatNPlayers(table, 6);
      // triggerMaybeStartHand しない

      const result = table.handleEarlyFold('player_0');
      expect(result).toBe(false);
    });
  });

  // --- unseatForFastFold ---

  describe('unseatForFastFold', () => {
    it('odIdとchipsとsocketが返る', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      // まずfoldしてからFF離席
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();
      table.handleAction(current!.odId, 'fold', 0);

      const result = table.unseatForFastFold(current!.odId);
      expect(result).not.toBeNull();
      expect(result!.odId).toBe(current!.odId);
      expect(result!.chips).toBeTypeOf('number');
      expect(result!.socket).toBe(current!.socket);
    });

    it('ソケットがルームから離脱する', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      table.handleAction(current!.odId, 'fold', 0);
      table.unseatForFastFold(current!.odId);

      expect(current!.socket.leave).toHaveBeenCalledWith(`table:${table.id}`);
    });

    it('table:leftは送信されない', () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      table.handleAction(current!.odId, 'fold', 0);
      table.unseatForFastFold(current!.odId);

      const leftEmits = getSocketEmits(current!.socket, 'table:left');
      expect(leftEmits).toHaveLength(0);
    });

    it('存在しないプレイヤーはnullを返す', () => {
      const { table } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const result = table.unseatForFastFold('nonexistent');
      expect(result).toBeNull();
    });
  });

  // --- onFastFoldReassign ---

  describe('onFastFoldReassign', () => {
    it('ハンド完了後にコールバックが呼ばれる', async () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const reassignFn = vi.fn();
      table.onFastFoldReassign = reassignFn;

      // 全員foldでハンド終了（5人fold → 残り1人勝利）
      for (let i = 0; i < 5; i++) {
        const current = findCurrentPlayer(table, odIds, sockets, seatMap);
        if (!current) break;
        table.handleAction(current.odId, 'fold', 0);
      }

      // handleHandComplete の遅延を進める
      await vi.advanceTimersByTimeAsync(2000); // HAND_COMPLETE_DELAY
      await vi.advanceTimersByTimeAsync(2000); // NEXT_HAND_DELAY

      expect(reassignFn).toHaveBeenCalledTimes(1);

      // コールバックにプレイヤー情報が渡される
      const players = reassignFn.mock.calls[0][0] as { odId: string; chips: number; socket: unknown }[];
      expect(players.length).toBeGreaterThan(0);
      for (const p of players) {
        expect(p.odId).toBeTruthy();
        expect(p.chips).toBeTypeOf('number');
        expect(p.socket).toBeTruthy();
      }
    });

    it('FF離席済みプレイヤーはコールバックに含まれない', async () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      const reassignFn = vi.fn();
      table.onFastFoldReassign = reassignFn;

      // 最初のプレイヤーをfold → unseatForFastFold
      const first = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(first).not.toBeNull();
      table.handleAction(first!.odId, 'fold', 0);
      table.unseatForFastFold(first!.odId);

      // 残りを全員fold
      for (let i = 0; i < 4; i++) {
        const current = findCurrentPlayer(table, odIds, sockets, seatMap);
        if (!current) break;
        table.handleAction(current.odId, 'fold', 0);
      }

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(reassignFn).toHaveBeenCalledTimes(1);

      const players = reassignFn.mock.calls[0][0] as { odId: string }[];
      const movedPlayer = players.find(p => p.odId === first!.odId);
      expect(movedPlayer).toBeUndefined();
    });

    it('コールバック未設定なら通常のmaybeStartHandが呼ばれる', async () => {
      const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

      // onFastFoldReassign を設定しない

      // 全員foldでハンド終了
      for (let i = 0; i < 5; i++) {
        const current = findCurrentPlayer(table, odIds, sockets, seatMap);
        if (!current) break;
        table.handleAction(current.odId, 'fold', 0);
      }

      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(2000);
      await vi.advanceTimersByTimeAsync(500);

      // FFコールバックがないので通常の次ハンド開始
      expect(table.isHandInProgress).toBe(true);
    });
  });
});
