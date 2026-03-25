import { BlindLevel } from './types';

// デフォルトブラインドスケジュール
export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1,  smallBlind: 1,   bigBlind: 2,   ante: 0, durationMinutes: 8 },
  { level: 2,  smallBlind: 2,   bigBlind: 4,   ante: 0, durationMinutes: 8 },
  { level: 3,  smallBlind: 3,   bigBlind: 6,   ante: 0, durationMinutes: 8 },
  { level: 4,  smallBlind: 5,   bigBlind: 10,  ante: 0, durationMinutes: 8 },
  { level: 5,  smallBlind: 8,   bigBlind: 16,  ante: 0, durationMinutes: 8 },
  { level: 6,  smallBlind: 10,  bigBlind: 20,  ante: 0, durationMinutes: 8 },
  { level: 7,  smallBlind: 15,  bigBlind: 30,  ante: 0, durationMinutes: 6 },
  { level: 8,  smallBlind: 20,  bigBlind: 40,  ante: 0, durationMinutes: 6 },
  { level: 9,  smallBlind: 30,  bigBlind: 60,  ante: 0, durationMinutes: 6 },
  { level: 10, smallBlind: 50,  bigBlind: 100, ante: 0, durationMinutes: 6 },
  { level: 11, smallBlind: 75,  bigBlind: 150, ante: 0, durationMinutes: 5 },
  { level: 12, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: 5 },
  { level: 13, smallBlind: 150, bigBlind: 300, ante: 0, durationMinutes: 5 },
  { level: 14, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: 5 },
  { level: 15, smallBlind: 300, bigBlind: 600, ante: 0, durationMinutes: 5 },
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

// 遅刻登録可能レベル
export const DEFAULT_LATE_REGISTRATION_LEVELS = 4;

// プレイヤー数に応じた賞金配分
export const PAYOUT_STRUCTURES: { maxPlayers: number; percentages: number[] }[] = [
  { maxPlayers: 6,  percentages: [65, 35] },
  { maxPlayers: 18, percentages: [50, 30, 20] },
  { maxPlayers: 27, percentages: [45, 25, 18, 12] },
  { maxPlayers: Infinity, percentages: [40, 23, 16, 12, 9] },
];
