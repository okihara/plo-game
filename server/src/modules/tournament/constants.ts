import { BlindLevel } from './types';

export const DEFAULT_DURATION_MINUTES = 5;

// デフォルトブラインドスケジュール（24レベル、SB/BB = 100/200 開始）
export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1,  smallBlind: 100,   bigBlind: 200,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 2,  smallBlind: 150,   bigBlind: 300,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 3,  smallBlind: 200,   bigBlind: 400,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 4,  smallBlind: 300,   bigBlind: 600,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 5,  smallBlind: 400,   bigBlind: 800,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 6,  smallBlind: 500,   bigBlind: 1000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 7,  smallBlind: 600,   bigBlind: 1200,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 8,  smallBlind: 800,   bigBlind: 1600,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 9,  smallBlind: 1000,  bigBlind: 2000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 10, smallBlind: 1200,  bigBlind: 2400,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 11, smallBlind: 1500,  bigBlind: 3000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 12, smallBlind: 2000,  bigBlind: 4000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 13, smallBlind: 2500,  bigBlind: 5000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 14, smallBlind: 3000,  bigBlind: 6000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 15, smallBlind: 4000,  bigBlind: 8000,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 16, smallBlind: 5000,  bigBlind: 10000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 17, smallBlind: 6000,  bigBlind: 12000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 18, smallBlind: 8000,  bigBlind: 16000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 19, smallBlind: 10000, bigBlind: 20000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 20, smallBlind: 12000, bigBlind: 24000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 21, smallBlind: 15000, bigBlind: 30000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 22, smallBlind: 20000, bigBlind: 40000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 23, smallBlind: 25000, bigBlind: 50000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 24, smallBlind: 30000, bigBlind: 60000, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
];

// デフォルト初期チップ
export const DEFAULT_STARTING_CHIPS = 30000;

// テーブルあたりの最大人数
export const PLAYERS_PER_TABLE = 6;

// 切断猶予時間（ms）
export const TOURNAMENT_DISCONNECT_GRACE_MS = 2 * 60 * 1000; // 2分

// デフォルトバイイン
export const DEFAULT_BUY_IN = 3000;

// 最小参加者数
export const DEFAULT_MIN_PLAYERS = 3;

// 最大参加者数（90テーブル × 6人）
export const DEFAULT_MAX_PLAYERS = 540;

// 登録可能レベル（開始からこのレベルまで参加可能）
export const DEFAULT_REGISTRATION_LEVELS = 8;

// プレイヤー数に応じた賞金配分
export const PAYOUT_STRUCTURES: { maxPlayers: number; percentages: number[] }[] = [
  { maxPlayers: 6,  percentages: [65, 35] },
  { maxPlayers: 18, percentages: [50, 30, 20] },
  { maxPlayers: 27, percentages: [45, 25, 18, 12] },
  { maxPlayers: Infinity, percentages: [40, 23, 16, 12, 9] },
];

// リエントリー可能回数
export const DEFAULT_MAX_REENTRIES = 2;