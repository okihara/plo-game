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
  /**
   * ICM ベースのバブルファクター（odId → 数値）。
   * 残テーブル数が少なくなった段階（実装では 2 卓以下）でのみ提供される。
   * 値の意味: 1.0=リング相当、>1.0=ICM 圧あり。
   */
  bubbleFactors?: Record<string, number>;
  /** レイト登録が閉じる時刻 (UNIX ms)。トーナメント未開始なら null。 */
  registrationDeadlineAt: number | null;
  /** リエントリーが閉じる時刻 (UNIX ms)。未開始 or allowReentry=false なら null。 */
  reentryDeadlineAt: number | null;
  /** 現時点でレイト登録を受け付けているか（クライアント側のクロック誤差に依存しない権威ある値） */
  isRegistrationOpen: boolean;
  /** そもそもリエントリー可能なトーナメントか（「不可」と「締切済み」を UI で出し分けるため） */
  allowReentry: boolean;
}

// --- Chip Standings (オンデマンド配信) ---

/**
 * チップスタンディングの1行。
 *
 * `ClientTournamentState` に同梱しないのは、`broadcastTournamentState()` が
 * チップ変動では飛ばない（参加/バスト/ブラインドアップ等でしか飛ばない）ため。
 * 同梱すると「古いチップの一覧が、たまに更新される」状態になる。
 * `tournament:request_standings` で必要なときだけ取りに行く。
 */
export interface TournamentStandingEntry {
  odId: string;
  /** 表示名（displayName またはマスク済み username）。生の username は送らない */
  name: string;
  avatarUrl: string | null;
  avatarId: number;
  chips: number;
  /** 同点は同順位（1, 2, 2, 4 の competition ranking） */
  rank: number;
  status: 'playing' | 'disconnected';
  reentries: number;
}

/** オンデマンド配信されるスタンディングのスナップショット */
export interface TournamentStandings {
  tournamentId: string;
  /** スナップショットを取った時刻 (UNIX ms) */
  updatedAt: number;
  playersRemaining: number;
  averageStack: number;
  /** chips 降順。残存プレイヤー全員 */
  entries: TournamentStandingEntry[];
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
  /** 表示名（displayName またはマスク済み username） */
  name: string;
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
  /** 表示名（displayName またはマスク済み username）。生の username は送らない */
  name: string;
  position: number | null;   // レイト登録中はnull
  playersRemaining: number;
}

// --- Tournament Completed ---

export interface TournamentCompletedData {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
}
