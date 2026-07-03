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
  name: 'シーズン２',
  label: '2026 7/1 -',
  start: new Date('2026-07-01T00:00:00+09:00'),
  // end は未定。確定するまでの暫定値（この日付までの完了トナメを集計対象に含める）。
  end: new Date('2026-12-31T23:59:59.999+09:00'),
  badgePrefix: 'season2',
};
