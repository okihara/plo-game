/// <reference types="node" />
/**
 * daily-ops-tick の実行コンテキスト。
 *
 * - `--prod`: 本番DB（DATABASE_PROD_PUBLIC_URL）+ 本番API（PROD_API_BASE_URL / PROD_ADMIN_SECRET）
 * - `--local`: ローカルDB（DATABASE_URL）+ http://localhost:3001（secret は ADMIN_SECRET があれば付与）
 * どちらかを必ず明示する（既存 scripts の --prod 明示の流儀に合わせ、誤爆を防ぐ）。
 *
 * 接続文字列・secret はログに出さない。admin API のログは path のみ記録する。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = join(__dirname, '..', '..', '..');

export type StepName =
  | 'create'
  | 'watchdog'
  | 'announce'
  | 'start'
  | 'progress'
  | 'result'
  | 'ranking';

export const ALL_STEPS: StepName[] = [
  'create', 'watchdog', 'announce', 'start', 'progress', 'result', 'ranking',
];

export class AdminApi {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string | undefined,
  ) {}

  private buildUrl(path: string): string {
    const url = new URL(path, this.baseUrl);
    if (this.secret) url.searchParams.set('secret', this.secret);
    return url.toString();
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<any> {
    const res = await fetch(this.buildUrl(path), {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  get(path: string): Promise<any> {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown): Promise<any> {
    return this.request('POST', path, body);
  }
}

export interface OpsContext {
  prisma: PrismaClient;
  api: AdminApi;
  now: Date;
  dryRun: boolean;
  prod: boolean;
  isStepEnabled(step: StepName): boolean;
  log(step: string, msg: string, extra?: Record<string, unknown>): void;
}

function argValue(argv: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function createContext(argv: string[]): OpsContext {
  config({ path: join(SERVER_ROOT, '.env'), quiet: true });

  const prod = argv.includes('--prod');
  const local = argv.includes('--local');
  if (prod === local) {
    throw new Error('--prod か --local のどちらか一方を必ず指定してください');
  }

  const dryRun = argv.includes('--dry-run');
  const nowArg = argValue(argv, 'now');
  const now = nowArg ? new Date(nowArg) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now の日時が不正です: ${nowArg}`);
  }

  const onlyArg = argValue(argv, 'only');
  let enabled: Set<StepName> | null = null;
  if (onlyArg) {
    const names = onlyArg.split(',').map((s) => s.trim()) as StepName[];
    for (const n of names) {
      if (!ALL_STEPS.includes(n)) throw new Error(`--only の step 名が不正です: ${n}`);
    }
    enabled = new Set(names);
  }

  let prisma: PrismaClient;
  let api: AdminApi;
  if (prod) {
    const dbUrl = process.env.DATABASE_PROD_PUBLIC_URL;
    if (!dbUrl) throw new Error('DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    const baseUrl = process.env.PROD_API_BASE_URL;
    if (!baseUrl) throw new Error('PROD_API_BASE_URL が .env に設定されていません（例: https://baby-plo.app）');
    const secret = process.env.PROD_ADMIN_SECRET;
    if (!secret) throw new Error('PROD_ADMIN_SECRET が .env に設定されていません');
    prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    api = new AdminApi(baseUrl, secret);
  } else {
    prisma = new PrismaClient();
    api = new AdminApi(process.env.LOCAL_API_BASE_URL ?? 'http://localhost:3001', process.env.ADMIN_SECRET);
  }

  const log = (step: string, msg: string, extra?: Record<string, unknown>) => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), step, msg, ...extra }));
  };

  return {
    prisma,
    api,
    now,
    dryRun,
    prod,
    isStepEnabled: (step) => enabled === null || enabled.has(step),
    log,
  };
}
