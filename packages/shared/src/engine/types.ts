import type { Card, Street, Action } from '../types.js';

// ======== HandPhase: ゲームフェーズの明示的な型表現 ========

export type HandPhase =
  | { type: 'waiting' }
  | { type: 'betting'; street: Street }
  | { type: 'showdown' }
  | { type: 'complete' };

// ======== GameCommand: エンジンへの入力 ========

export type GameCommand =
  | { type: 'START_HAND' }
  | { type: 'PLAYER_ACTION'; seatIndex: number; action: Action; amount?: number }
  | { type: 'TIMEOUT'; seatIndex: number };

// ======== GameEvent: エンジンからの出力 ========

export type GameEvent =
  | { type: 'HAND_STARTED'; dealerSeat: number; holeCards: Map<number, Card[]> }
  | { type: 'ACTION_APPLIED'; seatIndex: number; action: Action; amount: number }
  | { type: 'STREET_ADVANCED'; street: Street; newCards: Card[] }
  | { type: 'ALL_IN_RUNOUT'; communityCards: Card[] }
  | { type: 'SHOWDOWN_REACHED' }
  | { type: 'HAND_COMPLETED'; winners: WinnerInfo[]; rake: number };

export interface WinnerInfo {
  playerId: number;
  amount: number;
  handName: string;
}

// ======== processCommand の戻り型 ========

export interface CommandResult {
  state: import('../types.js').GameState;
  events: GameEvent[];
}
