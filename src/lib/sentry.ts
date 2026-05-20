import * as Sentry from '@sentry/react';

declare const __COMMIT_HASH__: string;

const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;

if (dsn) {
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)
      ?? (import.meta.env.MODE),
    release: (import.meta.env.VITE_SENTRY_RELEASE as string | undefined)
      ?? (typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : undefined),
    // エラー監視のみ。Performance / Replay は使わない。
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
}

export const sentryEnabled = Boolean(dsn);
export { Sentry };
