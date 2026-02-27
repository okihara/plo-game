// TableInstance テスト用モック & ヘルパーユーティリティ

import { vi } from 'vitest';
import type { Server, Socket } from 'socket.io';
import { TableInstance } from '../TableInstance.js';

// ============================================
// モックファクトリ
// ============================================

let socketCounter = 0;

/** Socket.io Server のモック */
export function createMockIO(): Server {
  const roomEmit = vi.fn();
  const io = {
    to: vi.fn().mockReturnValue({ emit: roomEmit }),
    emit: vi.fn(),
  } as unknown as Server;
  return io;
}

/** Socket オブジェクトのモック */
export function createMockSocket(id?: string): Socket {
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

// ============================================
// ヘルパー関数
// ============================================

/** N人をテーブルに着席させる。seatMap[i] = 実際の席番号 */
export function seatNPlayers(
  table: TableInstance,
  n: number,
  buyIn: number = 600
): { odIds: string[]; sockets: Socket[]; seatMap: number[] } {
  const odIds: string[] = [];
  const sockets: Socket[] = [];
  const seatMap: number[] = [];

  for (let i = 0; i < n; i++) {
    const odId = `player_${i}`;
    const socket = createMockSocket();
    const seat = table.seatPlayer(odId, `Player ${i}`, socket, buyIn);
    if (seat === null) throw new Error(`Failed to seat player ${i}`);
    odIds.push(odId);
    sockets.push(socket);
    seatMap.push(seat);
  }

  return { odIds, sockets, seatMap };
}

/** N人着席 + ハンド開始まで進める */
export function setupRunningHand(options?: {
  playerCount?: number;
  blinds?: string;
  buyIn?: number;
  isFastFold?: boolean;
}): { table: TableInstance; io: Server; odIds: string[]; sockets: Socket[]; seatMap: number[] } {
  const { playerCount = 3, blinds = '1/2', buyIn = 600, isFastFold = false } = options ?? {};

  const io = createMockIO();
  const table = new TableInstance(io, blinds, isFastFold);
  const { odIds, sockets, seatMap } = seatNPlayers(table, playerCount, buyIn);
  table.triggerMaybeStartHand();

  return { table, io, odIds, sockets, seatMap };
}

/**
 * dealerSeat から BB の席番号を算出する（POSITIONS配列: BTN=0, SB=+1, BB=+2）。
 * seatMap/odIds 配列の中でBBに該当するプレイヤーを返す。
 */
export function findBBPlayer(
  table: TableInstance,
  odIds: string[],
  sockets: Socket[],
  seatMap: number[]
): { odId: string; socket: Socket; playerIndex: number; seatIndex: number } | null {
  const state = table.getClientGameState();
  const bbSeat = (state.dealerSeat + 2) % 6;

  const idx = seatMap.indexOf(bbSeat);
  if (idx === -1) return null;

  return {
    odId: odIds[idx],
    socket: sockets[idx],
    playerIndex: idx,
    seatIndex: bbSeat,
  };
}

/**
 * getClientGameState().currentPlayerSeat から現在の手番プレイヤーを特定する。
 * seatMap[i] = テーブル上の席番号、odIds[i] = プレイヤーID
 */
export function findCurrentPlayer(
  table: TableInstance,
  odIds: string[],
  sockets: Socket[],
  seatMap: number[]
): { odId: string; socket: Socket; playerIndex: number; seatIndex: number } | null {
  const state = table.getClientGameState();
  if (state.currentPlayerSeat === null) return null;

  const idx = seatMap.indexOf(state.currentPlayerSeat);
  if (idx === -1) return null;

  return {
    odId: odIds[idx],
    socket: sockets[idx],
    playerIndex: idx,
    seatIndex: state.currentPlayerSeat,
  };
}

/** socket.emit の特定イベントの引数を全て取得 */
export function getSocketEmits(socket: Socket, eventName: string): unknown[] {
  const emitFn = socket.emit as ReturnType<typeof vi.fn>;
  return emitFn.mock.calls
    .filter(([event]: [string]) => event === eventName)
    .map(([, data]: [string, unknown]) => data);
}

/** io.to().emit のモックから特定イベントの引数を取得 */
export function getRoomEmits(io: Server, eventName: string): unknown[] {
  const toFn = io.to as ReturnType<typeof vi.fn>;
  // io.to() が返す { emit } の emit を取得
  if (toFn.mock.results.length === 0) return [];
  const roomMock = toFn.mock.results[0].value;
  const emitFn = roomMock.emit as ReturnType<typeof vi.fn>;
  return emitFn.mock.calls
    .filter(([event]: [string]) => event === eventName)
    .map(([, data]: [string, unknown]) => data);
}

/**
 * 全員allinまで進める。
 * buyIn を小さく設定して呼ぶこと（例: buyIn=6, blinds='1/2'）
 * 各プレイヤーのaction_requiredから'allin'アクションを探して実行する。
 */
export function allPlayersAllIn(
  table: TableInstance,
  odIds: string[],
  sockets: Socket[],
  seatMap: number[]
): void {
  let safety = 20;
  while (safety-- > 0) {
    const state = table.getClientGameState();
    if (state.currentPlayerSeat === null) break;

    const idx = seatMap.indexOf(state.currentPlayerSeat);
    if (idx === -1) break;

    const odId = odIds[idx];
    const socket = sockets[idx];

    // action_requiredから有効アクションを取得
    const actionEmits = getSocketEmits(socket, 'game:action_required');

    if (actionEmits.length === 0) break;

    const lastAction = actionEmits[actionEmits.length - 1] as {
      validActions: { action: string; minAmount: number; maxAmount: number }[];
    };

    // allin > call > check の優先度で実行
    const allinInfo = lastAction.validActions.find(a => a.action === 'allin');
    if (allinInfo) {
      table.handleAction(odId, 'allin', allinInfo.minAmount);
      continue;
    }

    const callInfo = lastAction.validActions.find(a => a.action === 'call');
    if (callInfo) {
      table.handleAction(odId, 'call', callInfo.minAmount);
      continue;
    }

    const checkInfo = lastAction.validActions.find(a => a.action === 'check');
    if (checkInfo) {
      table.handleAction(odId, 'check', 0);
      continue;
    }

    break;
  }
}

/** ソケットカウンターをリセット（beforeEach用） */
export function resetSocketCounter(): void {
  socketCounter = 0;
}
