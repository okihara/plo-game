// トーナメント中の指標計算（純粋関数のみ）。
//
// サーバーは「生のチップとペイアウト」だけを配信し、BB 換算・M レシオ・ITM 判定
// といった指標化はすべてここで行う。フロント（TournamentClockPanel）が主な利用者
// だが、Bot AI やリザルト集計から使っても同じ結果になるよう副作用を持たせない。
//
// テストは server の vitest スイート
// （server/src/modules/tournament/__tests__/tournamentMetrics.test.ts）から
// `@plo/shared` 経由で import する。icm.ts と同じ方針。

import type { GameVariant } from './types';
import { getVariantConfig } from './types';
import type { BlindLevel } from './tournament';

// ============================================
// ante の徴収方式（variant 差の単一の真実の源泉）
// ============================================

/**
 * ante の徴収方式。
 * - `none`: ante なし（PLO / Hold'em 系。gameEngine が ante: 0 固定）
 * - `all` : 全員が毎ハンド支払う（bomb pot・Stud 系）
 * - `bb`  : BB 席だけが毎ハンド支払う（Draw 系の BB アンティ）
 */
export type AnteMode = 'none' | 'all' | 'bb';

/**
 * variant ごとの ante 徴収方式を返す。
 *
 * 実装の根拠:
 * - `bombPotEngine.postAntes()`  — 全員から徴収
 * - `studEngine.postAntes()`     — 全員から徴収
 * - `drawEngine.postBlinds()`    — BB 席のみ徴収
 * - `gameEngine`                 — ante: 0 固定
 */
export function getAnteMode(variant: GameVariant): AnteMode {
  if (variant === 'plo_double_board_bomb') return 'all';
  const family = getVariantConfig(variant).family;
  if (family === 'stud') return 'all';
  if (family === 'draw') return 'bb';
  return 'none';
}

/**
 * 1オービット（テーブル1周）あたりに自分が失う強制ベットの総額。M レシオの分母。
 *
 * - `none`: sb + bb
 * - `bb`  : sb + bb + ante（BB アンティは1周に1回しか払わない）
 * - `all` : sb + bb + ante * tableSize（1周のあいだに tableSize 回払う）
 *
 * 未開始や異常な設定で 0 になりうるので、呼び出し側はゼロ除算に注意すること
 * （`computeStackMetrics` は内部でガードしている）。
 */
export function computeOrbitCost(
  level: BlindLevel,
  variant: GameVariant,
  tableSize: number,
): number {
  const blinds = level.smallBlind + level.bigBlind;
  const seats = Math.max(1, tableSize);
  switch (getAnteMode(variant)) {
    case 'all':
      return blinds + level.ante * seats;
    case 'bb':
      return blinds + level.ante;
    default:
      return blinds;
  }
}

/**
 * BB 換算の基準単位。
 * bomb pot は sb/bb を投稿せず `bigBlind = 0 / ante = N` で表現しているため、
 * ante を単位にフォールバックする。どちらも 0 なら 0（呼び出し側でガード）。
 */
export function getBigBlindUnit(level: BlindLevel): number {
  return level.bigBlind > 0 ? level.bigBlind : level.ante;
}

// ============================================
// スタック指標
// ============================================

/** Harrington の M ゾーン。有効M（10-handed 換算）から決まる。 */
export type MZone = 'green' | 'yellow' | 'orange' | 'red' | 'dead';

export interface StackMetrics {
  /** 残り BB 数（bomb pot は ante 換算） */
  bigBlinds: number;
  /** M = chips / orbitCost */
  m: number;
  /** 有効M = M * tableSize / 10（M ゾーンは 10-handed 基準で定義されているため） */
  effectiveM: number;
  /** 有効M から決まるゾーン */
  zone: MZone;
  /** 平均スタック比 (chips / averageStack)。averageStack が 0 なら 0 */
  averageStackRatio: number;
}

/** 有効M からゾーンを決める。境界は Harrington on Hold'em の定義に準拠。 */
export function getMZone(effectiveM: number): MZone {
  if (effectiveM >= 20) return 'green';
  if (effectiveM >= 10) return 'yellow';
  if (effectiveM >= 6) return 'orange';
  if (effectiveM >= 1) return 'red';
  return 'dead';
}

export function computeStackMetrics(input: {
  chips: number;
  level: BlindLevel;
  variant: GameVariant;
  tableSize: number;
  averageStack: number;
}): StackMetrics {
  const { chips, level, variant, tableSize, averageStack } = input;

  const bbUnit = getBigBlindUnit(level);
  const orbitCost = computeOrbitCost(level, variant, tableSize);
  const seats = Math.max(1, tableSize);

  const bigBlinds = bbUnit > 0 ? chips / bbUnit : 0;
  const m = orbitCost > 0 ? chips / orbitCost : 0;
  const effectiveM = (m * seats) / 10;

  return {
    bigBlinds,
    m,
    effectiveM,
    zone: getMZone(effectiveM),
    averageStackRatio: averageStack > 0 ? chips / averageStack : 0,
  };
}

// ============================================
// ITM / バブル / ペイアウトジャンプ
// ============================================

export interface PayoutSlot {
  position: number;
  amount: number;
}

export interface ItmInfo {
  /** 入賞人数（= payouts.length） */
  paidPlaces: number;
  /** 残り全員が入賞圏に入ったか */
  isInTheMoney: boolean;
  /** インマネまであと何人飛べばよいか。ITM 済みなら 0 */
  playersToItm: number;
  /** 今バストしたときの着順（= playersRemaining）。同時バストは考慮しない近似 */
  bustNowPosition: number;
  /** 今バストしたときの賞金。圏外なら 0 */
  bustNowPrize: number;
  /** 次に賞金が増える着順。もう無い（優勝のみ / 賞金なし）なら null */
  nextJumpPosition: number | null;
  /** その着順の賞金 */
  nextJumpPrize: number | null;
  /** 次のジャンプまであと何人飛べばよいか */
  playersToNextJump: number | null;
}

/**
 * 残り人数とペイアウト表から ITM 情報を導出する。
 * `payouts` は position 昇順でなくてよい（内部で Map 化する）。
 *
 * 注意: 次のジャンプは「1つ上の順位」と決め打ちできない。
 * `PrizeCalculator.generatePercentages()` は端数を丸めるので同額のスラブが
 * 隣接しうる（例: 3位と4位が同額）。実際に金額が増える位置まで遡る。
 */
export function computeItmInfo(playersRemaining: number, payouts: PayoutSlot[]): ItmInfo {
  const paidPlaces = payouts.length;
  const remaining = Math.max(0, playersRemaining);

  const prizeByPosition = new Map<number, number>();
  for (const p of payouts) prizeByPosition.set(p.position, p.amount);
  const prizeAt = (position: number): number => prizeByPosition.get(position) ?? 0;

  const bustNowPosition = remaining;
  const bustNowPrize = prizeAt(bustNowPosition);
  const isInTheMoney = paidPlaces > 0 && remaining <= paidPlaces;
  const playersToItm = paidPlaces > 0 ? Math.max(0, remaining - paidPlaces) : 0;

  let nextJumpPosition: number | null = null;
  let nextJumpPrize: number | null = null;
  if (paidPlaces > 0 && remaining > 1) {
    for (let position = bustNowPosition - 1; position >= 1; position--) {
      const amount = prizeAt(position);
      if (amount > bustNowPrize) {
        nextJumpPosition = position;
        nextJumpPrize = amount;
        break;
      }
    }
  }

  return {
    paidPlaces,
    isInTheMoney,
    playersToItm,
    bustNowPosition,
    bustNowPrize,
    nextJumpPosition,
    nextJumpPrize,
    playersToNextJump: nextJumpPosition == null ? null : bustNowPosition - nextJumpPosition,
  };
}

// ============================================
// 順位付け
// ============================================

export interface RankableStanding {
  odId: string;
  chips: number;
}

/**
 * chips 降順に並べ替えて rank を付与する。
 * 同点は同順位（1, 2, 2, 4 の competition ranking）。
 * 同点内は odId 昇順にして、呼び出しごとに並びが揺れないようにする。
 */
export function rankStandings<T extends RankableStanding>(rows: T[]): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => {
    if (b.chips !== a.chips) return b.chips - a.chips;
    return a.odId < b.odId ? -1 : a.odId > b.odId ? 1 : 0;
  });

  let lastChips: number | null = null;
  let lastRank = 0;
  return sorted.map((row, index) => {
    const rank = lastChips !== null && row.chips === lastChips ? lastRank : index + 1;
    lastChips = row.chips;
    lastRank = rank;
    return { ...row, rank };
  });
}
