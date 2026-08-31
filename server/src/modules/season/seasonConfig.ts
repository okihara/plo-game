/**
 * シーズン定義の単一の真実の源泉（Single Source of Truth）。
 *
 * RP ランキング集計スクリプト・特設ページ API・シーズンバッジの双方がここを参照する。
 * 新シーズンを始めるときは SEASON_n を定義して SEASONS に足し、CURRENT_SEASON を進める。
 */

export interface SeasonConfig {
  /** シーズン番号。URL（/season/:id）とバッジ接頭辞（season{id}）の元になる。 */
  id: number;
  name: string;
  label: string;
  start: Date;
  end: Date;
}

export const SEASON_1: SeasonConfig = {
  id: 1,
  name: 'シーズン１',
  label: '2026 1/1 - 6/30',
  start: new Date('2026-01-01T00:00:00+09:00'),
  end: new Date('2026-06-30T23:59:59.999+09:00'),
};

export const SEASON_2: SeasonConfig = {
  id: 2,
  name: 'シーズン２',
  label: '2026 7/1 - 8/31',
  start: new Date('2026-07-01T00:00:00+09:00'),
  end: new Date('2026-08-31T23:59:59.999+09:00'),
};

export const SEASON_3: SeasonConfig = {
  id: 3,
  name: 'シーズン３',
  label: '2026 9/1 -',
  start: new Date('2026-09-01T00:00:00+09:00'),
  // end は未定。確定するまでの暫定値（この日付までの完了トナメを集計対象に含める）。
  end: new Date('2026-12-31T23:59:59.999+09:00'),
};

/** 定義済みシーズン（古い順）。特設ページのアーカイブ一覧もこれを元に作る。 */
export const SEASONS: SeasonConfig[] = [SEASON_1, SEASON_2, SEASON_3];

/** 進行中のシーズン。ライブ集計（RPランキング・バッジ付与等）の対象。 */
export const CURRENT_SEASON: SeasonConfig = SEASON_3;

/**
 * 結果発表ページ（/season）が既定で表示する確定済みシーズン。
 * 新シーズンの終了後、スナップショット生成が済んだらここを切り替える。
 * これより新しいシーズンはアーカイブ一覧にも出さない（集計途中を公開しないため）。
 */
export const RESULT_SEASON: SeasonConfig = SEASON_2;

/** バッジ type の接頭辞（例 season1 → 'season1_no1' 等。BADGE_META と対応）。 */
export function seasonBadgePrefix(season: SeasonConfig): string {
  return `season${season.id}`;
}

/** シーズン番号（数値または数値文字列）→ シーズン定義。未知なら null。 */
export function findSeasonById(id: number | string | null | undefined): SeasonConfig | null {
  if (id === null || id === undefined || id === '') return null;
  const n = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(n)) return null;
  return SEASONS.find(s => s.id === n) ?? null;
}
