// プレイ画面のスキン（テーブル背景＋カード裏面）。
// 実際の色は src/index.css の `.game-bg[data-skin="..."]` で定義する。
// ここは id と表示名の単一の真実の源泉。新規スキンはここと index.css の両方に追加する。

export interface TableSkin {
  id: string;
  label: string;
}

export const TABLE_SKINS: readonly TableSkin[] = [
  { id: 'classic', label: 'クラシック' },
  { id: 'midnight', label: 'ミッドナイト' },
] as const;

export type TableSkinId = (typeof TABLE_SKINS)[number]['id'];

export const DEFAULT_TABLE_SKIN: TableSkinId = 'classic';

export function isTableSkinId(value: unknown): value is TableSkinId {
  return typeof value === 'string' && TABLE_SKINS.some(s => s.id === value);
}
