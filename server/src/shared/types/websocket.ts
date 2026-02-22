// WebSocket event types shared between client and server

import type { Action, Card } from '../logic/types.js';

// ========== Client -> Server Events ==========

export interface ClientToServerEvents {
  // Table actions
  'table:leave': () => void;
  'table:spectate': (data: { tableId: string }) => void;

  // Game actions
  'game:action': (data: { action: Action; amount?: number }) => void;

  // Matchmaking pool
  'matchmaking:join': (data: { blinds: string }) => void;
  'matchmaking:leave': () => void;
}

// ========== Server -> Client Events ==========

export interface ServerToClientEvents {
  // Connection
  'connection:established': (data: { playerId: string }) => void;
  'connection:error': (data: { message: string }) => void;

  // Table events
  'table:joined': (data: { tableId: string; seat: number }) => void;
  'table:left': () => void;
  'table:player_joined': (data: { seat: number; player: OnlinePlayer }) => void;
  'table:player_left': (data: { seat: number; playerId: string }) => void;
  'table:error': (data: { message: string }) => void;
  'table:busted': (data: { message: string }) => void;

  // Game state updates
  'game:state': (data: { state: ClientGameState }) => void;
  'game:hole_cards': (data: { cards: Card[] }) => void;
  'game:action_required': (data: {
    playerId: string;
    validActions: { action: Action; minAmount: number; maxAmount: number }[];
    timeoutMs: number;
  }) => void;
  'game:action_taken': (data: {
    playerId: string;
    action: Action;
    amount: number;
  }) => void;
  'game:street_changed': (data: { street: string; communityCards: Card[] }) => void;
  'game:showdown': (data: {
    winners: { playerId: string; amount: number; handName: string; cards: Card[] }[];
    players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
  }) => void;
  'game:hand_complete': (data: { winners: { playerId: string; amount: number; handName: string }[] }) => void;

  // Spectator
  'table:spectating': (data: { tableId: string }) => void;
  'game:all_hole_cards': (data: {
    players: { seatIndex: number; cards: Card[] }[];
  }) => void;

  // Maintenance
  'maintenance:status': (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;
}

// ========== Shared Types ==========

export interface OnlinePlayer {
  odId: string;
  odName: string;
  avatarId: number;
  avatarUrl?: string | null;  // Twitter/OAuth profile image URL
  seatNumber: number;
  chips: number;
  currentBet: number;
  folded: boolean;
  isAllIn: boolean;
  hasActed: boolean;
  isConnected: boolean;
}

// Client-safe game state (hides other players' hole cards)
export interface ClientGameState {
  tableId: string;
  players: (OnlinePlayer | null)[];
  communityCards: Card[];
  pot: number;
  sidePots: { amount: number; eligiblePlayerSeats: number[] }[];
  currentStreet: string;
  dealerSeat: number;
  currentPlayerSeat: number | null;
  currentBet: number;
  minRaise: number;
  smallBlind: number;
  bigBlind: number;
  isHandInProgress: boolean;
  // アクションタイムアウト情報
  actionTimeoutAt: number | null;  // タイムアウト時刻（UNIXタイムスタンプ、ミリ秒）
  actionTimeoutMs: number | null;  // タイムアウト時間（ミリ秒）
}

export interface TableInfo {
  id: string;
  name: string;
  blinds: string;
  players: number;
  maxPlayers: number;
  isFastFold: boolean;
}

// Socket authentication data
export interface SocketAuthData {
  token?: string;
  isBot?: boolean;
  botName?: string;
  botAvatar?: string | null;
}
