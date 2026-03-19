import { Socket } from 'socket.io';

// --- Tournament Status ---

export type TournamentStatus =
  | 'registering'
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
  ante: number;            // 将来対応（当面は0）
  durationMinutes: number;
}

// --- Tournament Config ---

export interface TournamentConfig {
  id: string;
  name: string;
  buyIn: number;
  startingChips: number;
  minPlayers: number;
  maxPlayers: number;
  playersPerTable: number;
  blindSchedule: BlindLevel[];
  lateRegistrationLevels: number;
  payoutPercentage: number[];
  startCondition: 'manual' | 'player_count' | 'scheduled';
  scheduledStartTime?: Date;
  requiredPlayerCount?: number;
  allowReentry: boolean;
  maxReentries: number;
  reentryDeadlineLevel: number;
}

// --- Tournament Player ---

export interface TournamentPlayer {
  odId: string;
  odName: string;
  displayName: string | null;
  avatarId: number;
  avatarUrl: string | null;
  socket: Socket | null;
  chips: number;
  tableId: string | null;
  seatIndex: number | null;
  status: 'registered' | 'playing' | 'eliminated' | 'disconnected';
  finishPosition: number | null;
  reentryCount: number;
  registeredAt: Date;
  eliminatedAt: Date | null;
  nameMasked: boolean;
}

// --- Client-facing States ---

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
  isLateRegistrationOpen: boolean;
  isFinalTable: boolean;
}

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
  isLateRegistrationOpen: boolean;
}

// --- Player Move ---

export interface PendingMove {
  odId: string;
  fromTableId: string;
  toTableId: string;
}

// --- Table Balance Result ---

export interface BalanceAction {
  type: 'move' | 'break';
  odId: string;
  fromTableId: string;
  toTableId: string;
}
