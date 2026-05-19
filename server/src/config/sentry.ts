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

/**
 * console.error を hook して Sentry に転送する。
 * プロジェクト内の多くの箇所が「try-catch → console.error で握り潰し」パターンで
 * エラーを処理しているため、wrapSocketHandler や Fastify onError では拾えない。
 * このブリッジを噛ませることで、既存のコードに手を入れずに Sentry へ流す。
 *
 * - 引数の中に Error インスタンスがあれば captureException
 * - 無ければ第一引数の文字列で captureMessage
 * - console.error 本来の出力（標準エラー）はそのまま実行する
 */
export function installConsoleErrorBridge(): void {
  if (!sentryEnabled) return;
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    originalError(...args);
    try {
      const errArg = args.find((a): a is Error => a instanceof Error);
      if (errArg) {
        Sentry.withScope((scope) => {
          scope.setTag('source', 'console.error');
          // Error 以外の引数（メッセージや context）を additional info として添える
          const extras = args.filter((a) => a !== errArg);
          if (extras.length > 0) {
            scope.setExtra('console_args', extras);
          }
          Sentry.captureException(errArg);
        });
      } else {
        const message = args
          .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
          .join(' ');
        Sentry.withScope((scope) => {
          scope.setTag('source', 'console.error');
          Sentry.captureMessage(message, 'error');
        });
      }
    } catch {
      // ブリッジ自身がアプリを壊さないように飲み込む
    }
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
