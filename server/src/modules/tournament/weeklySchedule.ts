/**
 * デイリートナメの曜日コンフィグ表（単一の真実の源泉）。
 *
 * 毎日22:00 JST開始のトナメを曜日ごとにどのバリアント・名前で立てるかを定義する。
 * 自動作成（scripts/ops/daily-ops-tick.ts）と告知文の特典文言（specialNote）が参照する。
 * 実運用値は本番DBの直近トナメ設定（2026-06 時点）と突き合わせて確定済み。
 */
import type { GameVariant } from '@plo/shared';
import type { BlindStructureId } from './constants.js';

export interface DailyTournamentPlan {
  gameVariant: GameVariant;
  /** トナメ名のラベル部。名前は `BabyPLO <label> M/D` になる */
  nameLabel: string;
  structureId: BlindStructureId;
  /** 告知に必ず織り込む特典文言（金曜の Amazon ギフト券など）。無い日は undefined */
  specialNote?: string;
}

const BASE_PLAN: Omit<DailyTournamentPlan, 'gameVariant' | 'nameLabel'> = {
  structureId: 'regular',
};

/** jstWeekday: 0=日 .. 6=土（JST判定は呼び出し側で jstWeekday() を使う） */
const WEEKLY_PLANS: Record<number, DailyTournamentPlan> = {
  0: { ...BASE_PLAN, gameVariant: 'plo_double_board_bomb', nameLabel: 'DBBP' },
  1: { ...BASE_PLAN, gameVariant: 'plo', nameLabel: 'Daily' },
  2: { ...BASE_PLAN, gameVariant: 'plo', nameLabel: 'Daily' },
  3: { ...BASE_PLAN, gameVariant: 'plo_hilo', nameLabel: 'PLO8' },
  4: { ...BASE_PLAN, gameVariant: 'plo', nameLabel: 'Daily' },
  5: {
    ...BASE_PLAN,
    gameVariant: 'plo',
    nameLabel: 'Daily',
    specialNote: '優勝者にAmazonギフト券1,000円分',
  },
  6: { ...BASE_PLAN, gameVariant: 'plo5', nameLabel: '5-Card' },
};

export function planForWeekday(jstWeekday: number): DailyTournamentPlan {
  const plan = WEEKLY_PLANS[jstWeekday];
  if (!plan) throw new Error(`invalid weekday: ${jstWeekday}`);
  return plan;
}

/** 本番の既存トナメと同じ `BabyPLO <label> M/D` 形式（月日はゼロ埋めしない） */
export function buildDailyTournamentName(
  plan: DailyTournamentPlan,
  jstDate: { month: number; day: number },
): string {
  return `BabyPLO ${plan.nameLabel} ${jstDate.month}/${jstDate.day}`;
}

/** 毎日の開始時刻（JST）。本番実績は 22:00 固定 */
export const DAILY_START_HOUR_JST = 22;

/** 作成時に POST /api/tournaments へ渡す固定パラメータ（本番実績値） */
export const DAILY_TOURNAMENT_BASE_CONFIG = {
  buyIn: 1000,
  startingChips: 30000,
  minPlayers: 3,
  maxPlayers: 102,
  registrationLevels: 8,
  allowReentry: true,
  maxReentries: 1,
  reentryDeadlineLevel: 8,
} as const;
