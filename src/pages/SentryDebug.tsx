import * as Sentry from '@sentry/react';

export function SentryDebug() {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const env = import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined;

  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-[3cqw] px-[6cqw] text-center">
      <h1 className="text-[5cqw] font-semibold text-cream-900">Sentry Debug</h1>
      <div className="text-[2.8cqw] text-cream-700 leading-relaxed">
        <div>DSN: {dsn ? '✅ 設定済み' : '❌ 未設定'}</div>
        <div>environment: {env ?? import.meta.env.MODE}</div>
      </div>

      <button
        type="button"
        onClick={() => {
          throw new Error('This is your first error!');
        }}
        className="px-[4cqw] py-[2cqw] rounded-[1.2cqw] bg-red-600 text-white text-[3cqw] font-semibold hover:bg-red-700"
      >
        Break the world (throw)
      </button>

      <button
        type="button"
        onClick={() => {
          Sentry.captureException(new Error('Manual captureException test'));
        }}
        className="px-[4cqw] py-[2cqw] rounded-[1.2cqw] bg-forest text-white text-[3cqw] font-semibold"
      >
        captureException を直接呼ぶ
      </button>

      <button
        type="button"
        onClick={() => {
          Sentry.captureMessage('Manual captureMessage test', 'info');
        }}
        className="px-[4cqw] py-[2cqw] rounded-[1.2cqw] bg-cream-700 text-white text-[3cqw] font-semibold"
      >
        captureMessage (info)
      </button>

      <a href="/" className="text-[2.5cqw] text-cream-700 underline mt-[2cqw]">
        ← ロビーへ戻る
      </a>
    </div>
  );
}
