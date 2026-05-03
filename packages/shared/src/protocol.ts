// WebSocket event types shared between client and server

import type { Action, Card, Position } from './types';
import type {
  BlindLevel,
  ClientTournamentState,
  TournamentEliminationInfo,
  TournamentPlayerEliminatedData,
  TournamentCompletedData,
} from './tournament';

// ========== Client -> Server Events ==========

export interface ClientToServerEvents {
  // Table actions
  'table:leave': () => void;
  /** 観戦入室（connectionMode: spectate の接続のみ可） */
  'table:spectate_join': (data: { tableId: string; inviteCode?: string }) => void;
  'table:spectate_leave': () => void;

  // Game actions
  'game:action': (data: { action: Action; amount?: number; discardIndices?: number[] }) => void;
  'game:fast_fold': () => void;

  // Matchmaking pool
  'matchmaking:join': (data: { blinds: string; isFastFold?: boolean; variant?: string }) => void;
  'matchmaking:leave': () => void;

  // Private table
  'private:create': (data: { blinds: string }) => void;
  'private:join': (data: { inviteCode: string }) => void;

  // Tournament
  'tournament:register': (data: { tournamentId: string }) => void;
  'tournament:unregister': (data: { tournamentId: string }) => void;
  'tournament:reenter': (data: { tournamentId: string }) => void;
  'tournament:request_state': (data: { tournamentId: string }) => void;
}

// ========== Server -> Client Events ==========

export interface ServerToClientEvents {
  // Connection
  'connection:established': (data: { playerId: string }) => void;
  'connection:displaced': (data: { reason: string }) => void;

  // Table events
  'table:joined': (data: { tableId: string; seat: number }) => void;
  'table:spectate_joined': (data: { tableId: string }) => void;
  'table:spectate_left': () => void;
  'table:left': () => void;
  'table:error': (data: { message: string }) => void;
  'table:busted': (data: { message: string }) => void;
  'table:change': (data: { tableId: string; seat: number }) => void;

  // Game state updates
  'game:state': (data: { state: ClientGameState }) => void;
  /** seatIndex 付きは着席者・観戦者共通。 */
  'game:hole_cards': (data: { cards: Card[]; seatIndex?: number }) => void;
  'game:action_taken': (data: {
    playerId: string;
    action: Action;
    amount: number;
  }) => void;
  'game:showdown': (data: {
    winners: { playerId: string; amount: number; handName: string; cards: Card[]; hiLoType?: 'high' | 'low' | 'scoop' }[];
    players: { seatIndex: number; odId: string; cards: Card[]; handName: string }[];
  }) => void;
  'game:hand_complete': (data: { winners: { playerId: string; amount: number; handName: string; hiLoType?: 'high' | 'low' | 'scoop' }[]; rake: number }) => void;

  // Maintenance
  'maintenance:status': (data: { isActive: boolean; message: string; activatedAt: string | null }) => void;

  // Announcement (no play restriction)
  'announcement:status': (data: { isActive: boolean; message: string }) => void;

  // Private table
  'private:created': (data: { tableId: string; inviteCode: string }) => void;

  // Tournament
  'tournament:registered': (data: { tournamentId: string }) => void;
  'tournament:unregistered': (data: { tournamentId: string }) => void;
  'tournament:state': (state: ClientTournamentState) => void;
  'tournament:table_assigned': (data: { tableId: string; tournamentId: string }) => void;
  'tournament:table_move': (data: { fromTableId: string; toTableId: string; reason: string }) => void;
  'tournament:blind_change': (data: { level: BlindLevel; nextLevel: BlindLevel | null; nextLevelAt: number }) => void;
  'tournament:player_eliminated': (data: TournamentPlayerEliminatedData) => void;
  'tournament:eliminated': (data: TournamentEliminationInfo) => void;
  'tournament:final_table': (data: { tableId: string }) => void;
  'tournament:completed': (data: TournamentCompletedData) => void;
  'tournament:error': (data: { message: string }) => void;
  'tournament:cancelled': (data: { tournamentId: string }) => void;
}

// ========== Shared Types ==========

export interface OnlinePlayer {
  odId: string;
  odName: string;
  avatarId: number;
  avatarUrl?: string | null;  // Twitter/OAuth profile image URL
  seatNumber: number;
  /** サーバーがハンド開始時に設定（空席・ハンド外フォールバック時は省略可） */
  position?: Position;
  chips: number;
  currentBet: number;
  folded: boolean;
  isAllIn: boolean;
  hasActed: boolean;
  isConnected: boolean;
  cards: Card[];  // Stud: 全カード配布順（裏カードはダミー値+isUp:false）, PLO: []
  hasWeeklyChampion?: boolean;  // ウィークリーチャンピオン（weekly_rank_1）バッジ保有者
}

// Client-safe game state (hides other players' hole cards)
export interface ClientGameState {
  tableId: string;
  players: (OnlinePlayer | null)[];
  communityCards: Card[];
  /** Double Board Bomb Pot: [board1, board2]。それ以外の variant は undefined。
   *  bomb pot 進行中は communityCards を boards[0] のミラーとして同期する。 */
  boards?: Card[][];
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
  rake: number;  // このハンドのレーキ額
  variant: string;  // 'plo' | 'stud'
  ante: number;     // Stud: アンテ額
  bringIn: number;  // Stud: ブリングイン額
  validActions: { action: string; minAmount: number; maxAmount: number }[] | null;
  /** 最小チップ単位。クライアントの bet スライダーがこの倍数しか選べないように
   *  step を切り上げる用途。トーナメント=100、キャッシュ=undefined(1相当)。 */
  chipUnit?: number;
}

export interface TableInfo {
  id: string;
  name: string;
  blinds: string;
  players: number;
  maxPlayers: number;
  isFastFold: boolean;
  isPrivate?: boolean;
}

// Socket authentication data
export interface SocketAuthData {
  token?: string;
  isBot?: boolean;
  botName?: string;
  botAvatar?: string | null;
}
