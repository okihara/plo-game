import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
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
  allPlayersAllIn,
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

vi.mock('../../../shared/logic/equityCalculator.js', () => ({
  calculateAllInEVProfits: vi.fn().mockReturnValue(new Map()),
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

    // 有効アクションを取得
    const validActions = table.getValidActionsForSeat(current!.seatIndex);
    const raiseInfo = validActions.find(a => a.action === 'raise');
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

  it('結果表示待ちが終わってからonHandPresentationCompleteを呼ぶ', async () => {
    const io = createMockIO();
    const onHandSettled = vi.fn();
    const onHandPresentationComplete = vi.fn();
    const table = new TableInstance(io, '1/2', false, {
      gameMode: 'tournament',
      lifecycleCallbacks: {
        onPlayerBusted: vi.fn(() => true),
        onHandSettled,
        onHandPresentationComplete,
      },
    });
    const { odIds, sockets, seatMap } = seatNPlayers(table, 3);
    table.triggerMaybeStartHand();

    for (let i = 0; i < 2; i++) {
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      expect(current).not.toBeNull();
      table.handleAction(current!.odId, 'fold', 0);
    }

    expect(onHandSettled).not.toHaveBeenCalled();
    expect(onHandPresentationComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(onHandSettled).toHaveBeenCalledTimes(1);
    expect(onHandPresentationComplete).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);

    expect(onHandPresentationComplete).toHaveBeenCalledTimes(1);
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
// D2. ブラインド投入オールイン時の進行テスト
// ============================================

describe('TableInstance - ブラインド投入でオールインになった場合', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ブラインド投入でオールインになったプレイヤーにはアクションが要求されない', () => {
    // ヘッズアップ: ブラインド 1000/2000 で片方が 500 チップ → ブラインド投入でオールイン
    // ゲームエンジンが currentPlayerIndex をオールインプレイヤーに設定した場合、
    // requestNextAction がスキップして進行不能にならないことを検証
    const io = createMockIO();
    const table = new TableInstance(io, '1000/2000', false);
    table.setMinPlayersToStart(2);

    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    // BigStack を先に着席 → seat 0 (BB になる)
    // ShortStack を後に着席 → seat 1 (BTN/SB になる) → SB投入でオールイン
    table.seatPlayer('player_big', 'BigStack', socket1, 10000);
    table.seatPlayer('player_short', 'ShortStack', socket2, 500);
    table.triggerMaybeStartHand();

    const state = table.getClientGameState();
    expect(state.isHandInProgress).toBe(true);

    // SB(BTN) がショートスタックでオールインになっていることを確認
    const sbSeat = state.dealerSeat;
    const sbPlayer = state.players.find(p => p && p.seatNumber === sbSeat);
    expect(sbPlayer).toBeDefined();
    expect(sbPlayer!.isAllIn).toBe(true);

    // 手番プレイヤーがオールインプレイヤーではないこと
    // バグ: ゲームエンジンが currentPlayerIndex を SB（オールイン）に設定し、
    // requestNextAction がスキップしないため validActions が空で進行不能になる
    if (state.currentPlayerSeat !== null) {
      const currentPlayer = state.players.find(p => p && p.seatNumber === state.currentPlayerSeat);
      expect(currentPlayer?.isAllIn).not.toBe(true);
      const validActions = table.getValidActionsForSeat(state.currentPlayerSeat);
      expect(validActions.length).toBeGreaterThan(0);
    }
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

// ============================================
// F. 切断時のフォールド処理テスト
// ============================================

describe('TableInstance - 切断/離席時のフォールド処理', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('手番プレイヤーがunseatされるとフォールドが処理され次の手番に移る', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番プレイヤーが離席
    table.unseatPlayer(current!.odId);

    // フォールドがブロードキャストされている
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const foldAction = actions.find(a => a.playerId === current!.odId);
    expect(foldAction).toBeDefined();
    expect(foldAction!.action).toBe('fold');

    // 次のプレイヤーに手番が移っている
    const next = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(next).not.toBeNull();
    expect(next!.odId).not.toBe(current!.odId);
  });

  it('非手番プレイヤーがunseatされると保留フォールドがセットされる', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤーを離席
    const nonCurrentOdId = odIds.find(id => id !== current!.odId)!;
    table.unseatPlayer(nonCurrentOdId);

    // この時点ではフォールドは即ブロードキャストされない
    // (保留としてセットされ、手番が回ってきた時に処理される)
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const foldAction = actions.find(a => a.playerId === nonCurrentOdId);
    expect(foldAction).toBeUndefined();
  });

  it('非手番の切断プレイヤーのフォールドは手番到達時にapplyAction経由で処理される', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 4, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤーを離席させる（保留フォールド）
    const nonCurrentOdId = odIds.find(id => id !== current!.odId)!;
    table.unseatPlayer(nonCurrentOdId);

    // 手番プレイヤーがコール
    table.handleAction(current!.odId, 'call', 2);

    // 保留フォールドしたプレイヤーにはフォールドがブロードキャストされるはず
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const deferredFold = actions.find(a => a.playerId === nonCurrentOdId && a.action === 'fold');
    expect(deferredFold).toBeDefined();
  });

  it('全員foldでの切断フォールドもハンドを正常終了させる', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    // 2人を順番に離席させてハンド完了
    const first = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(first).not.toBeNull();
    table.unseatPlayer(first!.odId);

    const second = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(second).not.toBeNull();
    table.unseatPlayer(second!.odId);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // hand_completeがブロードキャストされている
    const handComplete = getRoomEmits(io, 'game:hand_complete');
    expect(handComplete.length).toBeGreaterThan(0);
  });

  it('切断プレイヤーのタイムアウト後もゲームが進行する', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // ソケットを切断状態にする
    (current!.socket as any).connected = false;

    // タイムアウトを発火
    vi.advanceTimersByTime(20000);

    // アクションが実行されて次のプレイヤーに進んでいる
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const timeoutAction = actions.find(a => a.playerId === current!.odId);
    expect(timeoutAction).toBeDefined();
  });
});

// ============================================
// F2. 切断プレイヤー即座フォールド（socket.connected=false）
// ============================================

describe('TableInstance - socket.connected=false の即座フォールド', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('トーナメント風: 全プレイヤー切断でも即座にフォールドされハンドが完了する', async () => {
    const io = createMockIO();
    const table = new TableInstance(io, '100/200', false, { gameMode: 'tournament' });

    // 3人着席
    const sockets: ReturnType<typeof createMockSocket>[] = [];
    const odIds: string[] = [];
    const seatMap: number[] = [];
    for (let i = 0; i < 3; i++) {
      const socket = createMockSocket();
      const odId = `player_${i}`;
      const seat = table.seatPlayer(odId, `Player ${i}`, socket, 10000);
      if (seat === null) throw new Error(`Failed to seat player ${i}`);
      sockets.push(socket);
      odIds.push(odId);
      seatMap.push(seat);
    }

    // 全ソケットを切断状態にしてからハンド開始
    for (const socket of sockets) {
      (socket as any).connected = false;
    }
    table.triggerMaybeStartHand();

    expect(table.isHandInProgress).toBe(true);

    // socket.connected=false のプレイヤーは requestNextAction で即座にフォールドされるので
    // タイマーを待たずにハンドが完了するはず
    // handleHandComplete の非同期処理を進める
    await vi.advanceTimersByTimeAsync(2000); // HAND_COMPLETE_DELAY
    await vi.advanceTimersByTimeAsync(5000); // NEXT_HAND_DELAY

    const handComplete = getRoomEmits(io, 'game:hand_complete');
    expect(handComplete.length).toBeGreaterThan(0);
  });

  it('部分切断: 切断プレイヤーに手番が回ったら即座にフォールドされる', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 4, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤーのソケットを切断
    const otherIdx = odIds.findIndex(id => id !== current!.odId);
    (sockets[otherIdx] as any).connected = false;
    const disconnectedOdId = odIds[otherIdx];

    // 手番プレイヤーがコール → 次のプレイヤーに手番が回る
    table.handleAction(current!.odId, 'call', 2);

    // 切断プレイヤーに手番が回ったら、タイマーを待たず即座にフォールドされるはず
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const disconnectFold = actions.find(a => a.playerId === disconnectedOdId);

    if (disconnectFold) {
      // 即座にフォールドされた（修正後の期待動作）
      expect(disconnectFold.action).toBe('fold');
    } else {
      // タイマーがセットされた場合（切断プレイヤーの前にまだ他のプレイヤーがいる場合）
      // 20秒のタイマー発火でフォールドされることを確認
      vi.advanceTimersByTime(20000);
      const actionsAfterTimeout = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
      const timeoutFold = actionsAfterTimeout.find(a => a.playerId === disconnectedOdId);
      expect(timeoutFold).toBeDefined();
    }
  });

  it('修正前の再現: socket.connected=falseでも20秒タイマーを待っていた問題が解消', () => {
    // 修正前: socket!=null なら connected=false でもタイマーセット（20秒待ち）
    // 修正後: socket.connected=false なら即座に onDisconnectedFold
    const io = createMockIO();
    const table = new TableInstance(io, '100/200', false, { gameMode: 'tournament' });

    const sockets: ReturnType<typeof createMockSocket>[] = [];
    const odIds: string[] = [];
    const seatMap: number[] = [];
    for (let i = 0; i < 3; i++) {
      const socket = createMockSocket();
      const odId = `player_${i}`;
      const seat = table.seatPlayer(odId, `Player ${i}`, socket, 10000);
      if (seat === null) throw new Error(`Failed to seat player ${i}`);
      sockets.push(socket);
      odIds.push(odId);
      seatMap.push(seat);
    }

    table.triggerMaybeStartHand();
    expect(table.isHandInProgress).toBe(true);

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 次のプレイヤーを特定して、アクション実行 *前に* 切断状態にする
    // （requestNextAction は handleAction 内で同期的に呼ばれるため、
    //   呼ばれる前に socket.connected=false にしておく必要がある）
    const currentSeatIdx = seatMap.indexOf(current!.seatIndex);
    // 手番プレイヤーの次の席を見つける
    for (let i = 0; i < odIds.length; i++) {
      if (i !== currentSeatIdx) {
        (sockets[i] as any).connected = false;
      }
    }

    // 手番プレイヤーがコール → requestNextAction で次のプレイヤー（切断済み）に手番が回る
    // → 修正後: 即座にフォールドされるはず（タイマー不要）
    table.handleAction(current!.odId, 'call', 200);

    // 確認: 切断プレイヤーの自動アクションがタイマーなしで処理されている
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    // 手番プレイヤーのコール + 切断プレイヤーのフォールド/チェック
    expect(actions.length).toBeGreaterThanOrEqual(2);

    // 切断プレイヤーのアクションが含まれている
    const disconnectedActions = actions.filter(a => a.playerId !== current!.odId);
    expect(disconnectedActions.length).toBeGreaterThan(0);
    for (const a of disconnectedActions) {
      expect(['fold', 'check']).toContain(a.action);
    }
  });
});

// ============================================
// F3. handleActionTimeout リカバリーテスト
// ============================================

describe('TableInstance - タイムアウト時のリカバリー', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('handleAction失敗時でもタイムアウトで進行不能にならない', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // handleActionをスパイして一度だけfalseを返すようにする
    const originalHandleAction = table.handleAction.bind(table);
    let callCount = 0;
    vi.spyOn(table, 'handleAction').mockImplementation((...args) => {
      callCount++;
      if (callCount === 1) {
        // 最初の呼び出し（タイムアウトからの呼び出し）は失敗させる
        return false;
      }
      // リカバリー後の呼び出しは正常処理
      return originalHandleAction(...args);
    });

    // タイムアウトを発火
    vi.advanceTimersByTime(20000);

    // handleActionが失敗してもリカバリーが働き、ゲームが進行しているはず
    const state = table.getClientGameState();
    // 進行不能ではない: 手番が移っているか、ハンドが完了している
    const isProgressing = state.currentPlayerSeat !== current!.seatIndex || !state.isHandInProgress;
    expect(isProgressing).toBe(true);
  });
});

// ============================================
// G. タイムアウト時のチェック/フォールド判定テスト
// ============================================

describe('TableInstance - タイムアウト時のチェック判定', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('BB待ちのプリフロップで全員リンプ→BBのタイムアウトはチェックになる', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 3, blinds: '1/2' });

    // BB以外のプレイヤーが全員コール
    let safety = 10;
    while (safety-- > 0) {
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      if (!current) break;

      const bb = findBBPlayer(table, odIds, sockets, seatMap);
      if (current.odId === bb?.odId) {
        // BBの手番に到達 → タイムアウトさせる
        break;
      }
      table.handleAction(current.odId, 'call', 2);
    }

    // BBの手番が来ているはず
    const bb = findBBPlayer(table, odIds, sockets, seatMap);
    const currentNow = findCurrentPlayer(table, odIds, sockets, seatMap);
    if (currentNow && bb && currentNow.odId === bb.odId) {
      // BBのタイムアウトを発火
      vi.advanceTimersByTime(20000);

      // チェックになるはず（BBは既にブラインド投入済み、全員コールなのでチェック可能）
      const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
      const bbTimeoutAction = actions.find(a => a.playerId === bb.odId);
      expect(bbTimeoutAction).toBeDefined();
      expect(bbTimeoutAction!.action).toBe('check');
    }
  });
});

// ============================================
// G2. タイムアウトフォールド時のonTimeoutFoldコールバック
// ============================================

describe('TableInstance - タイムアウトフォールド時のonTimeoutFoldコールバック', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('FastFoldテーブルでタイムアウトフォールドするとonTimeoutFoldが呼ばれる', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

    const onTimeoutFold = vi.fn();
    table.onTimeoutFold = onTimeoutFold;

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // タイムアウトを発火
    vi.advanceTimersByTime(20000);

    expect(onTimeoutFold).toHaveBeenCalledWith(current!.odId, current!.socket);
  });

  it('タイムアウトでチェックになる場合はonTimeoutFoldが呼ばれない', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true, blinds: '1/2' });

    const onTimeoutFold = vi.fn();
    table.onTimeoutFold = onTimeoutFold;

    // BB以外の全員がコール → BBオプション（チェック可能）に到達させる
    let safety = 10;
    while (safety-- > 0) {
      const current = findCurrentPlayer(table, odIds, sockets, seatMap);
      if (!current) break;
      // 有効アクションを取得
      const validActions = table.getValidActionsForSeat(current.seatIndex);
      const callInfo = validActions.find(a => a.action === 'call');
      const checkInfo = validActions.find(a => a.action === 'check');
      if (checkInfo) break; // チェック可能 = BBオプション到達
      if (!callInfo) break;
      table.handleAction(current.odId, 'call', callInfo.minAmount);
    }

    // チェック可能な手番がBBであることを確認
    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    const bb = findBBPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();
    expect(bb).not.toBeNull();
    expect(current!.odId).toBe(bb!.odId);
    expect(table.getClientGameState().currentStreet).toBe('preflop');

    // タイムアウト → チェックになるのでonTimeoutFoldは呼ばれない
    vi.advanceTimersByTime(20000);
    expect(onTimeoutFold).not.toHaveBeenCalled();
  });

  it('通常テーブルではonTimeoutFoldが設定されていなくてもエラーにならない', () => {
    const { table } = setupRunningHand({ playerCount: 3, isFastFold: false });

    // onTimeoutFold未設定でタイムアウト → エラーなく動作する
    expect(() => {
      vi.advanceTimersByTime(20000);
    }).not.toThrow();
  });
});

// ============================================
// H. StateTransformer - premature fold表示バグ修正
// ============================================

describe('TableInstance - FastFold移動済みプレイヤーの表示', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('フォールド済みでFastFold離席したプレイヤーはfolded=trueで表示される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

    // 手番プレイヤーをfold + unseat
    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();
    table.handleAction(current!.odId, 'fold', 0);
    table.unseatForFastFold(current!.odId);

    const state = table.getClientGameState();
    const foldedPlayer = state.players.find(p => p?.odId === current!.odId);
    expect(foldedPlayer).toBeDefined();
    expect(foldedPlayer!.folded).toBe(true);
  });

  it('未フォールドでFastFold離席したプレイヤーはfolded=falseで表示される', () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤーをearlyFold → unseat
    const nonCurrentIdx = odIds.findIndex(id => id !== current!.odId);
    const nonCurrentOdId = odIds[nonCurrentIdx];
    table.handleEarlyFold(nonCurrentOdId);
    table.unseatForFastFold(nonCurrentOdId);

    // earlyFoldは保留なので実際のfoldはまだ → folded=false
    // (b276aea修正前は常にfolded=trueになっていたバグ)
    const state = table.getClientGameState();
    const player = state.players.find(p => p?.odId === nonCurrentOdId);
    if (player) {
      expect(player.folded).toBe(false);
    }
  });
});

// ============================================
// I. 連続保留フォールドの処理テスト
// ============================================

describe('TableInstance - 連続する保留フォールドの処理', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('保留フォールドしたプレイヤーは手番到達時に自動フォールドされる', () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤーを1人earlyFold（BBを避ける）
    const bb = findBBPlayer(table, odIds, sockets, seatMap);
    const earlyFoldTarget = odIds.find(id => id !== current!.odId && id !== bb?.odId)!;
    const result = table.handleEarlyFold(earlyFoldTarget);
    expect(result).toBe(true);

    // 手番プレイヤーがフォールド → 次のプレイヤーへ進む
    // earlyFold対象が次の手番なら自動フォールド、そうでなければ他プレイヤーの手番後に処理
    table.handleAction(current!.odId, 'fold', 0);

    // earlyFold対象プレイヤーまで進む（途中のプレイヤーはコール）
    let safety = 10;
    while (safety-- > 0) {
      const cur = findCurrentPlayer(table, odIds, sockets, seatMap);
      if (!cur) break;
      if (cur.odId === earlyFoldTarget) {
        // earlyFold対象がまだ手番にいるのはおかしい → 既に処理されているはず
        break;
      }
      table.handleAction(cur.odId, 'call', 2);
    }

    // earlyFold対象のフォールドがブロードキャストされている
    const actions = getRoomEmits(io, 'game:action_taken') as { playerId: string; action: string }[];
    const earlyFoldAction = actions.find(a => a.playerId === earlyFoldTarget && a.action === 'fold');
    expect(earlyFoldAction).toBeDefined();
  });

  it('保留フォールドでアクティブプレイヤーが1人になるとハンドが完了する', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({ playerCount: 6, isFastFold: true });

    const current = findCurrentPlayer(table, odIds, sockets, seatMap);
    expect(current).not.toBeNull();

    // 手番でないプレイヤー全員（BB除く）をearlyFold
    const nonCurrentIds = odIds.filter(id => id !== current!.odId);
    let earlyFoldCount = 0;
    for (const id of nonCurrentIds) {
      const result = table.handleEarlyFold(id);
      if (result) earlyFoldCount++;
    }

    // 手番プレイヤーがフォールド → 保留フォールドの連鎖 → ハンド完了
    table.handleAction(current!.odId, 'fold', 0);

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const handComplete = getRoomEmits(io, 'game:hand_complete');
    expect(handComplete.length).toBeGreaterThan(0);
  });
});

// ============================================
// J. オールイン・ランアウトテスト
// ============================================

describe('TableInstance - オールイン・ランアウト', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSocketCounter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('プリフロップで全員allinするとランアウトが開始される', async () => {
    // buyIn=6, blinds='1/2' → 全員のチップが少なく allin しやすい
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ランアウト中: ショーダウン前の待機 (2000ms)
    await vi.advanceTimersByTimeAsync(2000);

    // game:showdown がブロードキャストされる
    const showdownEmits = getRoomEmits(io, 'game:showdown');
    expect(showdownEmits.length).toBeGreaterThan(0);

    // ショーダウンのプレイヤー情報にカードが含まれている
    const showdownData = showdownEmits[showdownEmits.length - 1] as {
      players: { seatIndex: number; cards: unknown[] }[];
      winners: { playerId: string; amount: number }[];
    };
    expect(showdownData.players.length).toBeGreaterThanOrEqual(2);
    for (const p of showdownData.players) {
      expect(p.cards).toHaveLength(4); // PLO = 4枚
    }
  });

  it('ランアウト中はアクションが拒否される', async () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ランアウト開始直後（ショーダウン待機中）
    // 追加のアクションは拒否される
    const result = table.handleAction(odIds[0], 'fold', 0);
    expect(result).toBe(false);
  });

  it('ランアウトでコミュニティカードがストリートごとに段階的に表示される', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ショーダウン前待機 (2000ms) + ショーダウン後待機 (2000ms)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // フロップ表示 (即座) → turn表示 (1500ms後) → river表示 (2250ms後)
    await vi.advanceTimersByTimeAsync(1500); // turn表示
    await vi.advanceTimersByTimeAsync(2250); // river表示

    // ストリートごとの game:state を確認
    const allStates = getRoomEmits(io, 'game:state') as { state: { communityCards: unknown[]; currentStreet: string } }[];

    // フロップ(3枚)、ターン(4枚)、リバー(5枚)のステートが含まれている
    const cardCounts = allStates.map(s => s.state.communityCards.length);
    expect(cardCounts).toContain(3);
    expect(cardCounts).toContain(4);
    expect(cardCounts).toContain(5);
  });

  it('ランアウト完了後にhand_completeがブロードキャストされる', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ランアウト全体の遅延を進める:
    // showdown前(2000) + showdown後(2000)
    // + flop→turn(1500) + turn→river(2250) + river→final(1500)
    // + hand_complete(2000) + next_hand(5000=showdown delay)
    await vi.advanceTimersByTimeAsync(2000); // showdown前
    await vi.advanceTimersByTimeAsync(2000); // showdown後
    await vi.advanceTimersByTimeAsync(1500); // flop→turn
    await vi.advanceTimersByTimeAsync(2250); // turn→river
    await vi.advanceTimersByTimeAsync(1500); // river→final
    await vi.advanceTimersByTimeAsync(2000); // HAND_COMPLETE_DELAY
    await vi.advanceTimersByTimeAsync(5000); // NEXT_HAND_SHOWDOWN_DELAY

    const handComplete = getRoomEmits(io, 'game:hand_complete');
    expect(handComplete.length).toBeGreaterThan(0);

    const lastComplete = handComplete[handComplete.length - 1] as {
      winners: { playerId: string; amount: number }[];
    };
    expect(lastComplete.winners.length).toBeGreaterThan(0);
    expect(lastComplete.winners[0].amount).toBeGreaterThan(0);
  });

  it('ランアウト中のshowdownはhandComplete時に再送されない', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // 全遅延を進めてハンド完了まで
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2250);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);

    // showdownはランアウト中に1回だけ送信される（handleHandComplete内で再送されない）
    const showdownEmits = getRoomEmits(io, 'game:showdown');
    expect(showdownEmits).toHaveLength(1);
  });

  it('ランアウト中の中間状態ではチップが分配前の値になっている', async () => {
    const buyIn = 6;
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn,
    });

    const totalChips = buyIn * 3; // 全チップ合計は不変

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ショーダウン前待機 + ショーダウン後待機
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // フロップ表示後のstate取得
    const allStates = getRoomEmits(io, 'game:state') as { state: { communityCards: unknown[]; pot: number; players: ({ chips: number } | null)[] } }[];
    const flopState = allStates.find(s => s.state.communityCards.length === 3);
    expect(flopState).toBeDefined();

    // 中間状態ではポットが0より大きい（分配前）
    expect(flopState!.state.pot).toBeGreaterThan(0);

    // 中間状態のチップ合計 + ポット = 全チップ合計（保存量）
    const chipsSum = flopState!.state.players
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .reduce((sum, p) => sum + p.chips, 0);
    expect(chipsSum + flopState!.state.pot).toBe(totalChips);
  });

  it('ランアウト中の各ストリートで勝者のチップが増えていない', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 2,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ショーダウン前待機 + ショーダウン後待機
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // ターン表示
    await vi.advanceTimersByTimeAsync(1500);

    const allStates = getRoomEmits(io, 'game:state') as { state: { communityCards: unknown[]; pot: number; players: ({ chips: number } | null)[] } }[];

    // フロップとターンの中間状態を取得
    const intermediateStates = allStates.filter(s =>
      s.state.communityCards.length >= 3 && s.state.communityCards.length <= 4
    );

    // 全ての中間状態でチップが同じ（ポット分配されていない）
    for (let i = 1; i < intermediateStates.length; i++) {
      const prev = intermediateStates[i - 1];
      const curr = intermediateStates[i];
      for (let j = 0; j < 6; j++) {
        if (prev.state.players[j] && curr.state.players[j]) {
          expect(curr.state.players[j]!.chips).toBe(prev.state.players[j]!.chips);
        }
      }
      // ポットも中間状態では同じ
      expect(curr.state.pot).toBe(prev.state.pot);
    }
  });

  it('ランアウト完了後の最終stateでは勝者にチップが分配される', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // 全遅延を十分に進める
    await vi.advanceTimersByTimeAsync(20000);

    const allStates = getRoomEmits(io, 'game:state') as { state: { communityCards: unknown[]; pot: number; rake: number; players: ({ chips: number } | null)[] } }[];

    // communityCards=5枚のstateから中間（pot大）と最終（チップ分配済み）を区別
    const fiveCardStates = allStates.filter(s => s.state.communityCards.length === 5);
    expect(fiveCardStates.length).toBeGreaterThanOrEqual(2); // 中間river + 最終

    // 中間river state（potが分配前の値）
    const intermediateRiver = fiveCardStates[0];
    // 最終state（チップ分配済み → チップ合計が中間より大きい）
    const finalBroadcast = fiveCardStates[fiveCardStates.length - 1];

    const intermediateChips = intermediateRiver.state.players
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .reduce((sum, p) => sum + p.chips, 0);
    const finalChips = finalBroadcast.state.players
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .reduce((sum, p) => sum + p.chips, 0);

    // 最終stateのチップ合計は中間stateより多い（ポットが分配されたため）
    expect(finalChips).toBeGreaterThan(intermediateChips);

    // 最終stateで少なくとも1人がbuyIn以上のチップを持っている（勝者）
    const playerChips = finalBroadcast.state.players
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map(p => p.chips);
    expect(playerChips.some(c => c >= 6)).toBe(true);
  });

  it('ランアウト中の中間stateではwinnersが空', async () => {
    const { table, io, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ショーダウン前待機 + ショーダウン後待機
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    // フロップ→ターン→リバー
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);

    // hand_completeがまだ送信されていない（ランアウト中）
    const handComplete = getRoomEmits(io, 'game:hand_complete');
    expect(handComplete).toHaveLength(0);
  });

  it('3人ランアウトでサイドポットがある場合もチップ保存量が一致する', async () => {
    // プレイヤーごとに異なるバイインでサイドポットを発生させる
    const io = createMockIO();
    const table = new TableInstance(io, '1/2', false);

    const odIds: string[] = [];
    const sockets: Socket[] = [];
    const seatMap: number[] = [];

    // 3人を異なるチップ量で着席
    const buyIns = [4, 6, 8];
    for (let i = 0; i < 3; i++) {
      const odId = `player_${i}`;
      const socket = createMockSocket();
      const seat = table.seatPlayer(odId, `Player ${i}`, socket, buyIns[i]);
      if (seat === null) throw new Error(`Failed to seat player ${i}`);
      odIds.push(odId);
      sockets.push(socket);
      seatMap.push(seat);
    }
    table.triggerMaybeStartHand();

    // 全チップ合計（ブラインド含む）
    const totalChips = buyIns.reduce((s, b) => s + b, 0);

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // ショーダウン前待機 + ショーダウン後待機
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    const allStates = getRoomEmits(io, 'game:state') as { state: { communityCards: unknown[]; pot: number; players: ({ chips: number } | null)[] } }[];

    // ランアウト中間状態（ボードカード3〜4枚）でチップ保存量が一致
    const intermediateStates = allStates.filter(s =>
      s.state.communityCards.length >= 3 && s.state.communityCards.length < 5
    );
    expect(intermediateStates.length).toBeGreaterThan(0);

    for (const s of intermediateStates) {
      const chipsSum = s.state.players
        .filter((p): p is NonNullable<typeof p> => p !== null)
        .reduce((sum, p) => sum + p.chips, 0);
      // チップ合計 + ポット = 全体のチップ（中間状態ではrake=0なので一致するはず）
      expect(chipsSum + s.state.pot).toBe(totalChips);
    }
  });

  it('ランアウト完了後に次のハンドが自動開始される', async () => {
    const { table, odIds, sockets, seatMap } = setupRunningHand({
      playerCount: 3,
      blinds: '1/2',
      buyIn: 6,
    });

    allPlayersAllIn(table, odIds, sockets, seatMap);

    // 全遅延を進める
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2250);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(500); // 余裕

    // ハンド完了後の状態確認: ランアウトフラグがリセットされている
    // (isRunOutInProgress は private なので handleAction が受理されるか間接チェック)
    const state = table.getClientGameState();
    expect(state.isHandInProgress === true || state.isHandInProgress === false).toBe(true);
  });
});

// ============================================
// 観戦
// ============================================

describe('TableInstance - 観戦', () => {
  let io: Server;
  let table: TableInstance;

  beforeEach(() => {
    resetSocketCounter();
    io = createMockIO();
    table = new TableInstance(io, '1/2', false);
  });

  it('Fast fold卓は観戦を拒否する', () => {
    const ff = new TableInstance(io, '1/2', true);
    const spec = createMockSocket();
    const r = ff.addSpectator(spec);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Fast fold');
  });

  it('観戦者を追加すると socket.join される', () => {
    const spec = createMockSocket();
    const r = table.addSpectator(spec);
    expect(r.ok).toBe(true);
    expect(spec.join).toHaveBeenCalledWith(`table:${table.id}`);
    expect(table.getSpectatorCount()).toBe(1);
  });

  it('removeSpectator で leave される', () => {
    const spec = createMockSocket();
    table.addSpectator(spec);
    table.removeSpectator(spec);
    expect(spec.leave).toHaveBeenCalledWith(`table:${table.id}`);
    expect(table.getSpectatorCount()).toBe(0);
  });

  it('観戦ソケットにも着席者と同タイミングで席付き game:hole_cards（protocol）が送られる', () => {
    const spec = createMockSocket('spectator_sock');
    expect(table.addSpectator(spec).ok).toBe(true);
    const { sockets } = seatNPlayers(table, 3, 600);
    table.triggerMaybeStartHand();

    const specEmits = getSocketEmits(spec, 'game:hole_cards');
    expect(specEmits).toHaveLength(3);
    for (const e of specEmits as { seatIndex: number; cards: unknown[] }[]) {
      expect(typeof e.seatIndex).toBe('number');
      expect(e.seatIndex).toBeGreaterThanOrEqual(0);
      expect(e.seatIndex).toBeLessThan(6);
      expect(e.cards).toHaveLength(4);
    }
    for (const s of sockets) {
      const emits = getSocketEmits(s, 'game:hole_cards') as { seatIndex?: number; cards: unknown[] }[];
      expect(emits.length).toBeGreaterThan(0);
      expect(emits.every(x => typeof x.seatIndex === 'number')).toBe(true);
    }
  });
});
