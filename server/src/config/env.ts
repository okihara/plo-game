import { config } from 'dotenv';
import { z } from 'zod';

// Load .env file
config();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  /** OAuth ログイン用の App。Read-only 権限で十分（ユーザーに書き込み権限を求めない） */
  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_KEY_SECRET: z.string().optional(),
  /**
   * ツイート投稿用の別 App。Read and Write 権限が必要。
   * 公式アカウントから発行する Access Token と組み合わせて使う。
   */
  TWITTER_POST_API_KEY: z.string().optional(),
  TWITTER_POST_API_KEY_SECRET: z.string().optional(),
  TWITTER_POST_ACCESS_TOKEN: z.string().optional(),
  TWITTER_POST_ACCESS_TOKEN_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /** 移行期に追加で許可するオリジン（カンマ区切り）。CORS / Socket.io / OAuth の許可ホストに加わる。 */
  CLIENT_URL_ALIASES: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  /** トーナメントAI評価（OpenAI Chat Completions）。未設定時は生成APIは503。 */
  TOURNAMENT_EVAL_OPENAI_API_KEY: z.string().optional(),
  TOURNAMENT_EVAL_MODEL: z.string().default('gpt-5.4'),
  /** Sentry エラー監視。未設定時は無効。 */
  SENTRY_DSN: z.string().optional(),
  /** Sentry に送る environment タグ。未設定時は NODE_ENV を使う。 */
  SENTRY_ENVIRONMENT: z.string().optional(),
  /** Sentry に送る release タグ（コミットハッシュ等）。未設定時は Railway の値を使う。 */
  SENTRY_RELEASE: z.string().optional(),
  /** ツイートドラフトの LLM 生成用。未設定時は生成不可（DRAFT が常に FAILED になる）。 */
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-8'),
  /** false の間は tweetScheduler が起動しない（手動 enqueue/手動投稿のみ） */
  TWEET_SCHEDULER_ENABLED: z.coerce.boolean().default(false),
  /** true にすると承認なしで自動投稿。初期は必ず false。 */
  TWEET_AUTO_POST: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

export const allowedOrigins: string[] = [
  env.CLIENT_URL,
  ...(env.CLIENT_URL_ALIASES?.split(',').map((s) => s.trim()).filter(Boolean) ?? []),
];
