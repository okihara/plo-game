// Tournament types shared between client and server

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
  status: TournamentStatus;
  buyIn: number;
  startingChips: number;
  prizePool: number;
  totalPlayers: number;
  playersRemaining: number;
  currentBlindLevel: BlindLevel;
  nextBlindLevel: BlindLevel | null;
  nextLevelAt: number;           // UNIXタイムスタンプ (ms)
  myChips: number | null;
  myTableId: string | null;
  averageStack: number;
  largestStack: number;
  smallestStack: number;
  payoutStructure: { position: number; amount: number }[];
  isRegistrationOpen: boolean;
  isFinalTable: boolean;
}

// --- Tournament Lobby Info ---

export interface TournamentLobbyInfo {
  id: string;
  name: string;
  status: TournamentStatus;
  buyIn: number;
  startingChips: number;
  registeredPlayers: number;
  maxPlayers: number;
  currentBlindLevel: number;
  prizePool: number;
  scheduledStartTime?: string; // ISO string
  startedAt?: string;          // ISO string
  isRegistrationOpen: boolean;
  allowReentry: boolean;
  maxReentries: number;
  totalReentries: number;       // 実際に行われたリエントリー数
  reentryDeadlineLevel: number;
  registrationDeadlineAt?: string; // ISO string — エントリー締切時刻
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
  position: number;
  totalPlayers: number;
  prizeAmount: number;
}

// --- Player Eliminated (broadcast to all) ---

export interface TournamentPlayerEliminatedData {
  odId: string;
  odName: string;
  displayName: string | null;
  position: number;
  playersRemaining: number;
}

// --- Tournament Completed ---

export interface TournamentCompletedData {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
}

// --- Tournament Ranking Points ---

/**
 * 一つのトーナメントで入賞した上位 N 人に付与するランキングポイント。
 * インデックス0 = 1位、インデックス1 = 2位 ... という対応。
 * ここに無い順位（テーブル外、未入賞）は 0 ポイント。
 */
export const TOURNAMENT_RANKING_POINTS: readonly number[] = [
  100, // 1st
  70,  // 2nd
  50,  // 3rd
  40,  // 4th
  30,  // 5th
  25,  // 6th
  20,  // 7th
  15,  // 8th
  10,  // 9th
  5,   // 10th
] as const;

/**
 * 入賞順位に対して付与するランキングポイントを返す。
 * 範囲外（position < 1 や TOURNAMENT_RANKING_POINTS の長さを超える場合）は 0 を返す。
 */
export function getTournamentRankingPoints(position: number): number {
  if (!Number.isFinite(position) || position < 1) return 0;
  const idx = Math.floor(position) - 1;
  return TOURNAMENT_RANKING_POINTS[idx] ?? 0;
}

// --- Overall Tournament Ranking Entry ---

export interface TournamentRankingEntry {
  rank: number;            // 1-based 表示順位（同点は同じ rank にしない、連番）
  userId: string;
  username: string;        // 表示名（マスク済み）
  avatarUrl: string | null;
  isBot: boolean;
  totalPoints: number;     // 合算ポイント
  tournamentsCashed: number; // 入賞回数（ポイント付与を受けた回数）
  firstPlaces: number;     // 優勝回数
}
