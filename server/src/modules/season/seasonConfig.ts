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

export const CURRENT_SEASON: SeasonConfig = {
  name: 'シーズン１',
  label: '2026 1/1 - 6/30',
  start: new Date('2026-01-01T00:00:00+09:00'),
  end: new Date('2026-06-30T23:59:59.999+09:00'),
  badgePrefix: 'season1',
};
