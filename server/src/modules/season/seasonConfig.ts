/**
 * シーズン定義の単一の真実の源泉（Single Source of Truth）。
 *
 * RP ランキング集計スクリプト・特設ページ API の双方がここを参照する。
 * シーズンを切り替えるときはこのファイルだけ更新すればよい。
 */

export interface SeasonConfig {
  name: string;
  label: string;
  start: Date;
  end: Date;
  /** このシーズンのバッジ type の接頭辞（例 'season1' → 'season1_no1' 等。BADGE_META と対応）。 */
  badgePrefix: string;
}

export const SEASON_1: SeasonConfig = {
  name: 'シーズン１',
  label: '2026 1/1 - 6/30',
  start: new Date('2026-01-01T00:00:00+09:00'),
  end: new Date('2026-06-30T23:59:59.999+09:00'),
  badgePrefix: 'season1',
};

export const SEASON_2: SeasonConfig = {
  name: 'シーズン２',
  label: '2026 7/1 -',
  start: new Date('2026-07-01T00:00:00+09:00'),
  // end は未定。確定するまでの暫定値（この日付までの完了トナメを集計対象に含める）。
  end: new Date('2026-12-31T23:59:59.999+09:00'),
  badgePrefix: 'season2',
};

/** 進行中のシーズン。ライブ集計（RPランキング・バッジ付与等）の対象。 */
export const CURRENT_SEASON: SeasonConfig = SEASON_2;

/**
 * 結果発表ページ（/season）で表示する確定済みシーズン。
 * 新シーズンの終了後、スナップショット生成が済んだらここを切り替える。
 */
export const RESULT_SEASON: SeasonConfig = SEASON_1;
