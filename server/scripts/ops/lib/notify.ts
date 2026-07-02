/// <reference types="node" />
/**
 * macOS 通知（osascript）。cron から実行してもユーザーの通知センターに出る。
 * 同一 (businessDay, key) は1回だけ通知する（毎5分の tick で連打しない）。
 */
import { execFile } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { OpsContext } from './context.js';

export const LOG_DIR = join(homedir(), 'Library', 'Logs', 'plo-ops');

function notifiedFile(businessDayKey: string): string {
  return join(LOG_DIR, `notified-${businessDayKey}.json`);
}

function alreadyNotified(businessDayKey: string, key: string): boolean {
  const file = notifiedFile(businessDayKey);
  if (!existsSync(file)) return false;
  try {
    const keys: string[] = JSON.parse(readFileSync(file, 'utf8'));
    return keys.includes(key);
  } catch {
    return false;
  }
}

function markNotified(businessDayKey: string, key: string): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const file = notifiedFile(businessDayKey);
  let keys: string[] = [];
  if (existsSync(file)) {
    try {
      keys = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      keys = [];
    }
  }
  if (!keys.includes(key)) keys.push(key);
  writeFileSync(file, JSON.stringify(keys));
}

/**
 * 通知を1回だけ出す。dry-run のときはログのみ。
 * osascript の失敗（SSH セッション等）は握りつぶしてログに残す。
 */
export async function notifyOnce(
  ctx: OpsContext,
  businessDayKey: string,
  key: string,
  message: string,
): Promise<void> {
  ctx.log('notify', message, { key });
  if (ctx.dryRun) return;
  if (alreadyNotified(businessDayKey, key)) return;
  markNotified(businessDayKey, key);

  const script = `display notification ${JSON.stringify(message)} with title "BabyPLO Ops" sound name "Glass"`;
  await new Promise<void>((resolve) => {
    execFile('osascript', ['-e', script], (err) => {
      if (err) ctx.log('notify', `osascript failed: ${String(err)}`, { key });
      resolve();
    });
  });
}
