// Tournament types shared between client and server

import type { GameVariant } from './types.js';

// --- Tournament Status ---

export type TournamentStatus =
  | 'waiting'
  | 'starting'
  | 'running'
  | 'final_table'
  | 'heads_up'
  | 'completed'
  | 'cancelled';

// --- Blind Level ---

export interface BlindLevel {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
}

// --- Client-facing Tournament State ---

export interface ClientTournamentState {
  tournamentId: string;
  name: string;
  prizePool: number;
  totalPlayers: number;
  playersRemaining: number;
  currentBlindLevel: BlindLevel;
  nextBlindLevel: BlindLevel | null;
  nextLevelAt: number;           // UNIXタイムスタンプ (ms)
  averageStack: number;
  payoutStructure: { position: number; amount: number }[];
  gameVariant: GameVariant;  // 'plo' | 'plo5' (UI バッジ表示用)
}

// --- Tournament Lobby Info ---

export interface TournamentLobbyInfo {
  id: string;
  name: string;
  status: TournamentStatus;
  buyIn: number;
  startingChips: number;
  minPlayers?: number;
  registeredPlayers: number;
  maxPlayers: number;
  totalEntries?: number;
  playersRemaining?: number;
  tableCount?: number;
  currentBlindLevel: number;
  currentBlind?: BlindLevel;
  nextBlindLevel?: BlindLevel | null;
  nextLevelAt?: number;
  averageStack?: number;
  prizePool: number;
  scheduledStartTime?: string; // ISO string
  startedAt?: string;          // ISO string
  completedAt?: string;        // ISO string
  isRegistrationOpen: boolean;
  allowReentry: boolean;
  maxReentries: number;
  totalReentries: number;       // 実際に行われたリエントリー数
  reentryDeadlineLevel: number;
  registrationDeadlineAt?: string; // ISO string — エントリー締切時刻
  /** 完了トナメの優勝者（position=1）。displayName はサーバー側でマスク済み。 */
  winner?: { displayName: string; avatarUrl: string | null } | null;
  /** ファイナルテーブル(または heads_up)中のテーブルID。観戦リンク表示用。 */
  finalTableId?: string;
  gameVariant: GameVariant;  // 'plo' | 'plo5' (UI バッジ表示用)
}

// --- Finished Tournaments Pagination Window ---

/** /api/tournaments のレスポンスに付く、終了済みトーナメントの週ページネーション情報。 */
export interface FinishedTournamentsWindow {
  /** 今週=0, 先週=1, ... */
  weekOffset: number;
  /** 週の開始時刻 (JST 月曜 0:00) — ISO string */
  weekStart: string;
  /** 週の終了時刻 (翌週 JST 月曜 0:00, 半開) — ISO string */
  weekEnd: string;
  /** これより古い週に終了済みトーナメントが存在するか */
  hasOlder: boolean;
  /** これより新しい週があるか (weekOffset > 0 のとき true) */
  hasNewer: boolean;
}

// --- Tournament Result ---

export interface TournamentResult {
  odId: string;
  odName: string;
  position: number;
  prize: number;
  reentries: number;
  avatarUrl?: string | null;
}

// --- Elimination Info (sent to the eliminated player) ---

export interface TournamentEliminationInfo {
  position: number | null;   // レイト登録中はnull（順位未確定）
  totalPlayers: number;
  prizeAmount: number;
}

// --- Player Eliminated (broadcast to all) ---

export interface TournamentPlayerEliminatedData {
  odId: string;
  odName: string;
  displayName: string | null;
  position: number | null;   // レイト登録中はnull
  playersRemaining: number;
}

// --- Tournament Completed ---

export interface TournamentCompletedData {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
}
