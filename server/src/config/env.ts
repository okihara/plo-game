import { config } from 'dotenv';
import { z } from 'zod';

// Load .env file
config();

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  TWITTER_API_KEY: z.string().optional(),
  TWITTER_API_KEY_SECRET: z.string().optional(),
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /** 移行期に追加で許可するオリジン（カンマ区切り）。CORS / Socket.io / OAuth の許可ホストに加わる。 */
  CLIENT_URL_ALIASES: z.string().optional(),
  ADMIN_SECRET: z.string().optional(),
  /** トーナメントAI評価（OpenAI Chat Completions）。未設定時は生成APIは503。 */
  TOURNAMENT_EVAL_OPENAI_API_KEY: z.string().optional(),
  TOURNAMENT_EVAL_MODEL: z.string().default('gpt-5.4'),
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
