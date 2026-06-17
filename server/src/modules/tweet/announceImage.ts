/**
 * ANNOUNCE ツイートに添付する画像のパス解決。
 *
 * 解決順:
 *   1. 金曜なら friday_<basename>.jpeg （特別版）
 *   2. <basename>.jpeg
 *   3. plo4.jpeg （最終フォールバック）
 * いずれも見つからなければ undefined（添付なし）。
 *
 * 画像ファイルは assets/ に直置き。命名は実物に合わせる（plo→plo4, plo5→plo5_5card 等）。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, 'assets');

function variantBasename(variant: string): string | null {
  switch (variant) {
    case 'plo':
      return 'plo4';
    case 'plo5':
      return 'plo5_5card';
    case 'plo6':
      return 'plo6_6card';
    case 'omaha_hilo':
      return 'plo8_hi_lo';
    case 'plo_double_board_bomb':
      return 'double_boards_bombpot';
    default:
      return null;
  }
}

function weekdayInJst(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Tokyo' });
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[fmt.format(date)] ?? 0;
}

export function resolveAnnounceImagePath(
  scheduledStartTime: Date,
  gameVariant: string,
): string | undefined {
  const isFriday = weekdayInJst(scheduledStartTime) === 5;
  const base = variantBasename(gameVariant);

  const candidates: string[] = [];
  if (isFriday && base) candidates.push(`friday_${base}.jpeg`);
  if (base) candidates.push(`${base}.jpeg`);
  candidates.push('plo4.jpeg');

  for (const name of candidates) {
    const full = path.join(ASSETS_DIR, name);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}
