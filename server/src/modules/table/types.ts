// TableInstance用型定義

import { Socket } from 'socket.io';

export interface SeatInfo {
  odId: string;
  odName: string; // username（マスク対象）
  displayName?: string | null; // 表示名（設定済みならマスクしない）
  avatarId: number;
  avatarUrl: string | null; // Twitter/OAuth profile image URL
  socket: Socket | null;
  chips: number;
  buyIn: number;
  waitingForNextHand: boolean; // ハンド中に着席した場合、次のハンドから参加
  nameMasked: boolean; // 他プレイヤーにusernameをマスク表示するか
  leftForFastFold?: boolean; // FastFold移動済み（表示用に席情報を残す）
}

// ダッシュボード用：送信メッセージログ
export interface MessageLog {
  timestamp: number;
  event: string;
  target: 'all' | string; // 'all' = broadcast, string = playerId
  data: unknown;
}

// ダッシュボード用：待機中のアクションリクエスト
export interface PendingAction {
  playerId: string;
  playerName: string;
  seatNumber: number;
  validActions: { action: string; minAmount: number; maxAmount: number }[];
  requestedAt: number;
  timeoutMs: number;
}

// Fold処理のコンテキスト
export interface FoldContext {
  seatIndex: number;
  playerId: string;
  wasCurrentPlayer: boolean;
}

// ダッシュボード用：ゲーム状態デバッグ情報
export interface DebugState {
  messageLog: MessageLog[];
  pendingAction: PendingAction | null;
  gamePhase: string;
}

// 管理ダッシュボード用：シート詳細情報
export interface AdminSeat {
  seatNumber: number;
  odId: string;
  odName: string;
  chips: number;
  isConnected: boolean;
  folded: boolean;
  isAllIn: boolean;
  position: string;
  currentBet: number;
  totalBetThisRound: number;
  hasActed: boolean;
  isSittingOut: boolean;
  buyIn: number;
  waitingForNextHand: boolean;
}
