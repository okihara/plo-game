// Sentry を一番最初に読み込んで初期化する。
// このファイルは server/src/index.ts の最上段で import される必要がある
// （他モジュールが読み込まれる前に init を済ませて auto-instrumentation を有効化するため）。
import * as Sentry from '@sentry/node';
import { config } from 'dotenv';

// env.ts より前に評価される可能性があるので、ここでも .env を読み込む
config();

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA,
    // エラー監視のみ。Performance / Profiling は使わない。
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    // [調査用] MaxListenersExceededWarning の原因切り分け。
    // httpIntegration が res に close リスナーを足している疑いがあるので一時的に外す。
    integrations: (defaults) => defaults.filter((i) => i.name !== 'Http'),
  });
}

export const sentryEnabled = Boolean(dsn);
export { Sentry };

/**
 * 本物のエラーを Sentry に送りつつ、stderr にもログを残す。
 * catch ブロックで「ログだけ吐いて握り潰す」既存パターンの置き換え用。
 *
 * - `err` が Error なら captureException、それ以外なら message で captureMessage
 * - `context` は scope.setExtra で添える
 */
export function reportError(
  err: unknown,
  message: string,
  context?: Record<string, unknown>,
): void {
  if (context) {
    console.error(message, context, err);
  } else {
    console.error(message, err);
  }
  if (!sentryEnabled) return;
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
    }
    if (err instanceof Error) {
      Sentry.captureException(err);
    } else {
      if (err !== undefined && err !== null) {
        scope.setExtra('thrown_value', err);
      }
      Sentry.captureMessage(message, 'error');
    }
  });
}
