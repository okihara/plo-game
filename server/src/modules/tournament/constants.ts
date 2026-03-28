import { BlindLevel } from './types';

export const DEFAULT_DURATION_MINUTES = 0.5;

// デフォルトブラインドスケジュール
export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1,  smallBlind: 1,   bigBlind: 2,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 2,  smallBlind: 2,   bigBlind: 4,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 3,  smallBlind: 3,   bigBlind: 6,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 4,  smallBlind: 5,   bigBlind: 10,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 5,  smallBlind: 8,   bigBlind: 16,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 6,  smallBlind: 10,  bigBlind: 20,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 7,  smallBlind: 15,  bigBlind: 30,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 8,  smallBlind: 20,  bigBlind: 40,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 9,  smallBlind: 30,  bigBlind: 60,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 10, smallBlind: 50,  bigBlind: 100, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 11, smallBlind: 75,  bigBlind: 150, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 12, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 13, smallBlind: 150, bigBlind: 300, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 14, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 15, smallBlind: 300, bigBlind: 600, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 16, smallBlind: 400, bigBlind: 800, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 17, smallBlind: 500, bigBlind: 1000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 18, smallBlind: 750, bigBlind: 1500, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 19, smallBlind: 1000, bigBlind: 2000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 20, smallBlind: 1500, bigBlind: 3000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
];

// デフォルト初期チップ
export const DEFAULT_STARTING_CHIPS = 1500;

// テーブルあたりの最大人数
export const PLAYERS_PER_TABLE = 6;

// 切断猶予時間（ms）
export const TOURNAMENT_DISCONNECT_GRACE_MS = 2 * 60 * 1000; // 2分

// デフォルトバイイン
export const DEFAULT_BUY_IN = 100;

// 最小参加者数
export const DEFAULT_MIN_PLAYERS = 6;

// 最大参加者数（9テーブル × 6人）
export const DEFAULT_MAX_PLAYERS = 540;

// 登録可能レベル（開始からこのレベルまで参加可能）
export const DEFAULT_REGISTRATION_LEVELS = 4;

// プレイヤー数に応じた賞金配分
export const PAYOUT_STRUCTURES: { maxPlayers: number; percentages: number[] }[] = [
  { maxPlayers: 6,  percentages: [65, 35] },
  { maxPlayers: 18, percentages: [50, 30, 20] },
  { maxPlayers: 27, percentages: [45, 25, 18, 12] },
  { maxPlayers: Infinity, percentages: [40, 23, 16, 12, 9] },
];
