/**
 * JST（Asia/Tokyo）基準の時刻ユーティリティ。
 *
 * サーバー・cron の実行環境のタイムゾーンに依存せず、Intl で JST に変換して判定する。
 * `new Date().getDay()` などローカルTZ依存の曜日・日付判定はここを経由すること。
 */

export interface JstParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  /** 0=日 .. 6=土 */
  weekday: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export function jstParts(date: Date): JstParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false,
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl は 24:00 表記を返す環境があるため正規化
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAY_MAP[parts.weekday] ?? 0,
  };
}

/** 'HH:MM'（JST）表記。ツイート文面の締切時刻などに使う */
export function formatJstTime(date: Date): string {
  const { hour, minute } = jstParts(date);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** JST の年月日+時刻を UTC の Date にする（JST = UTC+9、DSTなし） */
export function jstDate(
  year: number, month: number, day: number, hour = 0, minute = 0,
): Date {
  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
}

/**
 * 「営業日」の日付（JST で now − rolloverHours 時間の日付）。
 * 深夜 0〜6 時の tick でも前日の 22:00 開催トナメを対象にするための日跨ぎ対策。
 */
export function opsDateParts(now: Date, rolloverHours = 6): JstParts {
  return jstParts(new Date(now.getTime() - rolloverHours * 3_600_000));
}
