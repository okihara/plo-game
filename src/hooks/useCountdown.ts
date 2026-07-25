import { useEffect, useState } from 'react';

/**
 * 目標時刻までの残り時間を `MM:SS`（1時間以上なら `H:MM:SS`）で整形する。
 * 過ぎている場合は `00:00`。
 */
export function formatCountdownTo(targetMs: number): string {
  const diff = Math.max(0, targetMs - Date.now());
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 目標時刻までのカウントダウンを毎秒更新して返す。
 * `targetMs` が null なら null を返してタイマーも張らない
 * （締切が存在しない＝トーナメント未開始／リエントリー不可などのケース）。
 */
export function useCountdown(targetMs: number | null): string | null {
  const [remaining, setRemaining] = useState<string | null>(() =>
    targetMs == null ? null : formatCountdownTo(targetMs),
  );

  useEffect(() => {
    if (targetMs == null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(formatCountdownTo(targetMs));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  return remaining;
}
