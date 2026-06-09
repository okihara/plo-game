/// <reference types="node" />
/**
 * /api/admin/stats を定期取得して JSONL に保存する監視用スクリプト。
 *
 * 実行例:
 *   cd server && npx tsx scripts/poll-admin-stats.ts
 *   cd server && npx tsx scripts/poll-admin-stats.ts --url https://baby-plo.app --interval 10s
 *   cd server && npx tsx scripts/poll-admin-stats.ts --out logs/admin-stats.jsonl --full
 */
import 'dotenv/config';
import { appendFile, mkdir } from 'fs/promises';
import path from 'path';

type AdminStats = {
  timestamp?: string;
  uptime?: number;
  connections?: {
    total?: number;
    authenticated?: number;
    disconnects?: unknown;
  };
  tables?: {
    total?: number;
    regular?: number;
    fastFold?: number;
    activeHands?: number;
  };
  database?: {
    connected?: boolean;
    userCount?: number;
    queryLatency?: unknown;
  };
  runtime?: unknown;
  memory?: unknown;
  tournaments?: {
    total?: number;
  };
};

const args = process.argv.slice(2);
const intervalMs = parseDuration(getArg('--interval') ?? process.env.ADMIN_STATS_POLL_INTERVAL ?? '10s');
const outputPath = path.resolve(getArg('--out') ?? process.env.ADMIN_STATS_LOG_PATH ?? 'logs/admin-stats.jsonl');
const full = args.includes('--full');
const once = args.includes('--once');
const timeoutMs = parseDuration(getArg('--timeout') ?? process.env.ADMIN_STATS_TIMEOUT ?? '5s');
let stopped = false;

const statsUrl = buildStatsUrl(getArg('--url') ?? process.env.ADMIN_STATS_URL ?? process.env.SERVER_URL ?? 'http://localhost:3001');

process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});

async function main() {
  await mkdir(path.dirname(outputPath), { recursive: true });
  console.log(`Polling admin stats every ${intervalMs}ms -> ${outputPath}`);
  console.log(`Target: ${statsUrl.origin}${statsUrl.pathname}`);

  do {
    const startedAt = Date.now();
    await pollOnce();
    if (once || stopped) break;

    const elapsedMs = Date.now() - startedAt;
    await sleep(Math.max(0, intervalMs - elapsedMs));
  } while (!stopped);
}

async function pollOnce() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(statsUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const stats = await response.json() as AdminStats;
    await appendJsonLine(full ? stats : compactStats(stats));
  } catch (error) {
    await appendJsonLine({
      capturedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timeout);
  }
}

function compactStats(stats: AdminStats) {
  return {
    capturedAt: new Date().toISOString(),
    timestamp: stats.timestamp,
    uptime: stats.uptime,
    connections: {
      total: stats.connections?.total ?? 0,
      authenticated: stats.connections?.authenticated ?? 0,
      disconnects: stats.connections?.disconnects ?? null,
    },
    tables: {
      total: stats.tables?.total ?? 0,
      regular: stats.tables?.regular ?? 0,
      fastFold: stats.tables?.fastFold ?? 0,
      activeHands: stats.tables?.activeHands ?? 0,
    },
    tournaments: {
      total: stats.tournaments?.total ?? 0,
    },
    database: {
      connected: stats.database?.connected ?? false,
      userCount: stats.database?.userCount ?? 0,
      queryLatency: stats.database?.queryLatency ?? null,
    },
    runtime: stats.runtime ?? null,
    memory: stats.memory ?? null,
  };
}

async function appendJsonLine(value: unknown) {
  await appendFile(outputPath, `${JSON.stringify(value)}\n`, 'utf8');
}

function buildStatsUrl(baseUrl: string): URL {
  const url = new URL('/api/admin/stats', baseUrl);
  const secret = process.env.ADMIN_SECRET;
  if (secret && !url.searchParams.has('secret')) {
    url.searchParams.set('secret', secret);
  }
  return url;
}

function getArg(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/);
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'ms';
  if (unit === 'm') return Math.round(amount * 60_000);
  if (unit === 's') return Math.round(amount * 1000);
  return Math.round(amount);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
