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
  });
}

export const sentryEnabled = Boolean(dsn);
export { Sentry };
