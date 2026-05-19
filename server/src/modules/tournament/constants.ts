import type { GameVariant } from '@plo/shared';
import { BlindLevel } from './types';

// --- ブラインドストラクチャ プリセット ---
// ストラクチャはブラインド表 + 関連する推奨初期値（startingChips / registrationLevels）を担う。
// 作成フォームではこれらが既定値として反映されるが、ユーザーが任意に上書きできる。
// blindSchedule は base ladder (DEFAULT_BLIND_SCHEDULE / DEFAULT_BOMB_POT_BLIND_SCHEDULE) を
// 各レベルの durationMinutes だけ上書きして組み立てる。
export type BlindStructureId = 'regular' | 'deep' | 'hyper';

export interface BlindStructureMeta {
  id: BlindStructureId;
  label: string;
  durationMinutes: number;
  startingChips: number;
  registrationLevels: number;
}

export const BLIND_STRUCTURES: BlindStructureMeta[] = [
  {
    id: 'regular',
    label: 'Regular (5分/Lv)',
    durationMinutes: 5,
    startingChips: 30000,
    registrationLevels: 8,
  },
  {
    id: 'deep',
    label: 'Deep (8分/Lv)',
    durationMinutes: 8,
    startingChips: 30000,
    registrationLevels: 10,
  },
  {
    id: 'hyper',
    label: 'Hyper (0.5分/Lv)',
    durationMinutes: 0.5,
    startingChips: 30000,
    registrationLevels: 4,
  },
];

export const DEFAULT_BLIND_STRUCTURE_ID: BlindStructureId = 'regular';

// デフォルトブラインドスケジュール（SB/BB = 100/200 開始）
// 全レベルの sb/bb を chipUnit (=100) の倍数で揃える。
// 各 level の durationMinutes は resolveBlindSchedule でストラクチャの値に上書きされるため、
// ここに書かれた値はプレースホルダ。
export const DEFAULT_BLIND_SCHEDULE: BlindLevel[] = [
  { level: 1,  smallBlind: 100,    bigBlind: 200,    ante: 0, durationMinutes: 5 },
  { level: 2,  smallBlind: 200,    bigBlind: 300,    ante: 0, durationMinutes: 5 },
  { level: 3,  smallBlind: 200,    bigBlind: 400,    ante: 0, durationMinutes: 5 },
  { level: 4,  smallBlind: 300,    bigBlind: 500,    ante: 0, durationMinutes: 5 },
  { level: 5,  smallBlind: 300,    bigBlind: 600,    ante: 0, durationMinutes: 5 },
  { level: 6,  smallBlind: 400,    bigBlind: 800,    ante: 0, durationMinutes: 5 },
  { level: 7,  smallBlind: 500,    bigBlind: 1000,   ante: 0, durationMinutes: 5 },
  { level: 8,  smallBlind: 600,    bigBlind: 1200,   ante: 0, durationMinutes: 5 },
  { level: 9,  smallBlind: 800,    bigBlind: 1600,   ante: 0, durationMinutes: 5 },
  { level: 10, smallBlind: 1000,   bigBlind: 2000,   ante: 0, durationMinutes: 5 },
  { level: 11, smallBlind: 1500,   bigBlind: 3000,   ante: 0, durationMinutes: 5 },
  { level: 12, smallBlind: 2000,   bigBlind: 4000,   ante: 0, durationMinutes: 5 },
  { level: 13, smallBlind: 3000,   bigBlind: 6000,   ante: 0, durationMinutes: 5 },
  { level: 14, smallBlind: 4000,   bigBlind: 8000,   ante: 0, durationMinutes: 5 },
  { level: 15, smallBlind: 5000,   bigBlind: 10000,  ante: 0, durationMinutes: 5 },
  { level: 16, smallBlind: 6000,   bigBlind: 12000,  ante: 0, durationMinutes: 5 },
  { level: 17, smallBlind: 8000,   bigBlind: 16000,  ante: 0, durationMinutes: 5 },
  { level: 18, smallBlind: 10000,  bigBlind: 20000,  ante: 0, durationMinutes: 5 },
  { level: 19, smallBlind: 15000,  bigBlind: 30000,  ante: 0, durationMinutes: 5 },
  { level: 20, smallBlind: 20000,  bigBlind: 40000,  ante: 0, durationMinutes: 5 },
  { level: 21, smallBlind: 30000,  bigBlind: 60000,  ante: 0, durationMinutes: 5 },
  { level: 22, smallBlind: 40000,  bigBlind: 80000,  ante: 0, durationMinutes: 5 },
  { level: 23, smallBlind: 50000,  bigBlind: 100000, ante: 0, durationMinutes: 5 },
  { level: 24, smallBlind: 60000,  bigBlind: 120000, ante: 0, durationMinutes: 5 },
  { level: 25, smallBlind: 80000,  bigBlind: 160000, ante: 0, durationMinutes: 5 },
  { level: 26, smallBlind: 100000, bigBlind: 200000, ante: 0, durationMinutes: 5 },
  { level: 27, smallBlind: 150000, bigBlind: 300000, ante: 0, durationMinutes: 5 },
  { level: 28, smallBlind: 200000, bigBlind: 400000, ante: 0, durationMinutes: 5 },
  { level: 29, smallBlind: 300000, bigBlind: 600000, ante: 0, durationMinutes: 5 },
  { level: 30, smallBlind: 400000, bigBlind: 800000, ante: 0, durationMinutes: 5 },
  { level: 31, smallBlind: 500000, bigBlind: 1000000, ante: 0, durationMinutes: 5 },
  { level: 32, smallBlind: 600000, bigBlind: 1200000, ante: 0, durationMinutes: 5 },
  { level: 33, smallBlind: 800000, bigBlind: 1600000, ante: 0, durationMinutes: 5 },
  { level: 34, smallBlind: 1000000, bigBlind: 2000000, ante: 0, durationMinutes: 5 },
  { level: 35, smallBlind: 1500000, bigBlind: 3000000, ante: 0, durationMinutes: 5 },
] as const;

// DBBP 用デフォルトスケジュール (sb=0/bb=0/ante=N)
// DEFAULT_BLIND_SCHEDULE と同じステップだが ante フィールドに値を入れる
export const DEFAULT_BOMB_POT_BLIND_SCHEDULE: BlindLevel[] = DEFAULT_BLIND_SCHEDULE.map(l => ({
  level: l.level,
  smallBlind: 0,
  bigBlind: 0,
  ante: l.bigBlind,
  durationMinutes: l.durationMinutes,
}));

// デフォルト初期チップ
export const DEFAULT_STARTING_CHIPS = 30000;

// テーブルあたりの最大人数
export const PLAYERS_PER_TABLE = 6;

// 切断猶予時間（ms）
export const TOURNAMENT_DISCONNECT_GRACE_MS = 2 * 60 * 1000; // 2分

// デフォルトバイイン
export const DEFAULT_BUY_IN = 1000;

// 最小参加者数
export const DEFAULT_MIN_PLAYERS = 3;

// 最大参加者数（17テーブル × 6人）
export const DEFAULT_MAX_PLAYERS = 102;

// 登録可能レベル（開始からこのレベルまで参加可能）
export const DEFAULT_REGISTRATION_LEVELS = 8;

// リエントリーを含む総エントリー数に対して、上位15%（切り捨て、最低1名）を入賞圏にする。
export const DEFAULT_PAYOUT_RATE = 0.15;

// 入賞順位数に応じた賞金配分。6位以上は PrizeCalculator で動的生成する。
// 各構造は線形配分から 1 位に概ね +5pt 寄せた値を採用し、優勝者に少し厚くしている。
export const PAYOUT_STRUCTURES: { paidPlaces: number; percentages: number[] }[] = [
  { paidPlaces: 1, percentages: [100] },
  { paidPlaces: 2, percentages: [70, 30] },
  { paidPlaces: 3, percentages: [55, 28, 17] },
  { paidPlaces: 4, percentages: [50, 24, 16, 10] },
  { paidPlaces: 5, percentages: [45, 22, 15, 11, 7] },
];

// リエントリー可能回数
export const DEFAULT_MAX_REENTRIES = 2;

/**
 * structureId と variant からブラインド表を組み立てる。
 * ベース ladder は variant に応じて DEFAULT_BLIND_SCHEDULE / DEFAULT_BOMB_POT_BLIND_SCHEDULE。
 * 各レベルの durationMinutes だけをストラクチャで上書きする。
 */
export function resolveBlindSchedule(
  structureId: BlindStructureId | undefined,
  variant: GameVariant,
): BlindLevel[] {
  const meta = BLIND_STRUCTURES.find(s => s.id === structureId) ?? BLIND_STRUCTURES[0];
  const base = variant === 'plo_double_board_bomb'
    ? DEFAULT_BOMB_POT_BLIND_SCHEDULE
    : DEFAULT_BLIND_SCHEDULE;
  return base.map(l => ({ ...l, durationMinutes: meta.durationMinutes }));
}
