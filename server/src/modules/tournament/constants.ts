import { BlindLevel } from './types';

export const DEFAULT_DURATION_MINUTES = 5;

// デフォルトブラインドスケジュール（23レベル、SB/BB = 1/2 開始）
//
// チップは内部的に 1/100 単位で扱う（chipUnit=100）。表示時に UI が ×100 する。
// 表示上は 100/200 開始 → 60000/30000 終了 (旧: 100/200 → 60000/30000)。
// 旧 level 2 (150/300, 表示) は 1/100 すると 1.5/3 になり整数化できないため drop。
export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1,  smallBlind: 1,   bigBlind: 2,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 2,  smallBlind: 2,   bigBlind: 4,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 3,  smallBlind: 3,   bigBlind: 6,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 4,  smallBlind: 4,   bigBlind: 8,   ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 5,  smallBlind: 5,   bigBlind: 10,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 6,  smallBlind: 6,   bigBlind: 12,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 7,  smallBlind: 8,   bigBlind: 16,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 8,  smallBlind: 10,  bigBlind: 20,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 9,  smallBlind: 12,  bigBlind: 24,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 10, smallBlind: 15,  bigBlind: 30,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 11, smallBlind: 20,  bigBlind: 40,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 12, smallBlind: 25,  bigBlind: 50,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 13, smallBlind: 30,  bigBlind: 60,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 14, smallBlind: 40,  bigBlind: 80,  ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 15, smallBlind: 50,  bigBlind: 100, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 16, smallBlind: 60,  bigBlind: 120, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 17, smallBlind: 80,  bigBlind: 160, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 18, smallBlind: 100, bigBlind: 200, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 19, smallBlind: 120, bigBlind: 240, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 20, smallBlind: 150, bigBlind: 300, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 21, smallBlind: 200, bigBlind: 400, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 22, smallBlind: 250, bigBlind: 500, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
  { level: 23, smallBlind: 300, bigBlind: 600, ante: 0, durationMinutes: DEFAULT_DURATION_MINUTES },
];

// デフォルト初期チップ (内部 1/100 単位、表示は 30000)
export const DEFAULT_STARTING_CHIPS = 300;

// テーブルあたりの最大人数
export const PLAYERS_PER_TABLE = 6;

// 切断猶予時間（ms）
export const TOURNAMENT_DISCONNECT_GRACE_MS = 2 * 60 * 1000; // 2分

// デフォルトバイイン
export const DEFAULT_BUY_IN = 1000;

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