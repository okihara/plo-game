import { Socket } from 'socket.io';

// Re-export shared types (client/server 共通)
export type {
  TournamentStatus,
  BlindLevel,
  ClientTournamentState,
  TournamentLobbyInfo,
  TournamentResult,
  TournamentEliminationInfo,
  TournamentPlayerEliminatedData,
  TournamentCompletedData,
} from '@plo/shared';

import type { BlindLevel } from '@plo/shared';

// --- Tournament Config (server only) ---

export interface TournamentConfig {
  id: string;
  name: string;
  buyIn: number;
  startingChips: number;
  minPlayers: number;
  maxPlayers: number;
  playersPerTable: number;
  blindSchedule: BlindLevel[];
  registrationLevels: number;
  payoutPercentage: number[];
  startCondition: 'manual' | 'player_count' | 'scheduled';
  scheduledStartTime?: Date;
  requiredPlayerCount?: number;
  allowReentry: boolean;
  maxReentries: number;
  reentryDeadlineLevel: number;
}

// --- Tournament Player (server only) ---

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
  status: 'playing' | 'eliminated' | 'disconnected';
  finishPosition: number | null;
  reentryCount: number;
  registeredAt: Date;
  eliminatedAt: Date | null;
  nameMasked: boolean;
  hasWeeklyChampion?: boolean;
}

// --- Player Move (server only) ---

export interface PendingMove {
  odId: string;
  fromTableId: string;
  toTableId: string;
}

// --- Table Balance Result (server only) ---

export interface BalanceAction {
  type: 'move' | 'break';
  odId: string;
  fromTableId: string;
  toTableId: string;
}
