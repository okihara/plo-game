// WebSocket event types shared between client and server

import type { Action, Card, Position, Player } from './types';
import { POSITIONS } from './types';
import type { PlayerProfile } from './profile';
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
  'table:spectate_join': (data: { tableId: string }) => void;
  'table:spectate_leave': () => void;

  // Game actions
  'game:action': (data: { action: Action; amount?: number; discardIndices?: number[] }) => void;
  'game:fast_fold': () => void;

  // Matchmaking pool
  'matchmaking:join': (data: { blinds: string; isFastFold?: boolean; variant?: string }) => void;
  'matchmaking:leave': () => void;

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
  /**
   * 接続時にトーナメント・キャッシュテーブルのいずれにも席がないことを伝える。
   * FastFold で切断中に move-and-cashout された後の再接続などで、
   * 「席に戻ったつもりで居る」クライアントを再マッチング等へ誘導する目印。
   */
  'session:no_seat': () => void;

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
  /** 着席時に確定した公開プロフィール（表示名・アバター・ネームプレート装飾） */
  profile: PlayerProfile;
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
}

/**
 * OnlinePlayer（プロトコル表現）をゲームエンジンの Player に変換する。
 * クライアントの描画用変換と Bot AI の状況構築で共通利用。
 * 空席は folded/isSittingOut のプレースホルダーになる。
 */
export function convertOnlinePlayerToPlayer(
  online: OnlinePlayer | null,
  index: number,
  dealerSeat: number
): Player {
  const fallbackPosition = POSITIONS[(index - dealerSeat + 6) % 6];
  if (!online) {
    return {
      id: index,
      name: `Seat ${index + 1}`,
      chips: 0,
      holeCards: [],
      currentBet: 0,
      totalBetThisRound: 0,
      folded: true,
      isAllIn: false,
      hasActed: true,
      isSittingOut: true,
      position: fallbackPosition,
    };
  }

  return {
    id: index,
    name: online.profile.name,
    chips: online.chips,
    holeCards: online.cards ?? [],
    currentBet: online.currentBet,
    totalBetThisRound: online.currentBet,
    folded: online.folded,
    isAllIn: online.isAllIn,
    hasActed: online.hasActed,
    isSittingOut: false,
    position: online.position ?? fallbackPosition,
    avatarId: online.profile.avatarId,
    avatarUrl: online.profile.avatarUrl,
    odId: online.odId,
    nameplate: online.profile.nameplate,
  };
}

// Socket authentication data
export interface SocketAuthData {
  token?: string;
  isBot?: boolean;
  botName?: string;
  botAvatar?: string | null;
}
