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
