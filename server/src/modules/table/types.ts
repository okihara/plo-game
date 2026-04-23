// TableInstance用型定義

import { Socket } from 'socket.io';

// ゲームモード（キャッシュゲーム / トーナメント）
export type GameMode = 'cash' | 'tournament';

/**
 * テーブルライフサイクルコールバック
 * キャッシュゲームとトーナメントで異なる振る舞いを外部から注入する
 */
export interface TableLifecycleCallbacks {
  /**
   * プレイヤーがバスト（チップ0）した時の処理
   * - キャッシュゲーム: table:busted通知 → unseat → cashOut
   * - トーナメント: 順位記録 → リバイ提示 or 脱落処理
   * @param chipsAtHandStart 当該ハンド開始時のチップ（同時バスト時の順位決定に使用）
   * @returns true: TableInstanceがunseatPlayerを呼ぶ, false: 呼び出し側が管理
   */
  onPlayerBusted: (
    odId: string,
    seatIndex: number,
    socket: Socket | null,
    chipsAtHandStart: number
  ) => boolean;

  /**
   * ハンド完了後のチップ精算処理
   * - キャッシュゲーム: 何もしない（離席時にcashOut）
   * - トーナメント: チップをトーナメントエントリに同期
   */
  onHandSettled?: (seatChips: { odId: string; seatIndex: number; chips: number }[]) => void;

  /**
   * バスト処理完了後のコールバック（onPlayerBusted ループ完了後に1回呼ばれる）
   * - トーナメント: pendingBusts の一括順位確定・フェーズ遷移を実行
   */
  onBustsProcessed?: () => void;
}

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
  hasWeeklyChampion?: boolean; // ウィークリーチャンピオンバッジ保有（着席時にスナップショット）
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
