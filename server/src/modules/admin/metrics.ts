import os from 'os';
import { monitorEventLoopDelay, performance } from 'perf_hooks';

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const cpuCount = os.cpus().length;
let previousCpuUsage = process.cpuUsage();
let previousCpuSampleAt = performance.now();

const dbQueryLatencySamples: number[] = [];
const MAX_DB_QUERY_LATENCY_SAMPLES = 1000;
let dbQueryCount = 0;
let dbQueryTotalMs = 0;
let dbQueryMaxMs = 0;
let dbLastQueryAt: string | null = null;

const socketDisconnectsByReason = new Map<string, number>();
const socketDisconnectsByRole = new Map<string, number>();
let socketDisconnectTotal = 0;
let socketDisconnectServerCaused = 0;
let socketDisconnectClientCaused = 0;

export interface LatencyStats {
  count: number;
  avgMs: number;
  maxMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface RuntimeMetrics {
  eventLoopDelay: LatencyStats & {
    minMs: number;
    stddevMs: number;
  };
  cpu: {
    cores: number;
    userMicros: number;
    systemMicros: number;
    percentOfOneCore: number;
    percentOfSystem: number;
  };
}

export interface DbQueryLatencyMetrics extends LatencyStats {
  recentSampleSize: number;
  lastQueryAt: string | null;
}

export interface SocketDisconnectMetrics {
  total: number;
  serverCaused: number;
  clientCaused: number;
  byReason: Record<string, number>;
  byRole: Record<string, number>;
}

export function recordDbQueryLatency(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) return;

  dbQueryCount += 1;
  dbQueryTotalMs += durationMs;
  dbQueryMaxMs = Math.max(dbQueryMaxMs, durationMs);
  dbLastQueryAt = new Date().toISOString();

  dbQueryLatencySamples.push(durationMs);
  if (dbQueryLatencySamples.length > MAX_DB_QUERY_LATENCY_SAMPLES) {
    dbQueryLatencySamples.shift();
  }
}

export function recordSocketDisconnect(reason: string, options: { role: string; serverCaused: boolean }): void {
  const normalizedReason = reason || 'unknown';
  const normalizedRole = options.role || 'unknown';

  socketDisconnectTotal += 1;
  if (options.serverCaused) {
    socketDisconnectServerCaused += 1;
  } else {
    socketDisconnectClientCaused += 1;
  }

  socketDisconnectsByReason.set(
    normalizedReason,
    (socketDisconnectsByReason.get(normalizedReason) ?? 0) + 1
  );
  socketDisconnectsByRole.set(
    normalizedRole,
    (socketDisconnectsByRole.get(normalizedRole) ?? 0) + 1
  );
}

export function getRuntimeMetrics(): RuntimeMetrics {
  const currentCpuUsage = process.cpuUsage();
  const currentSampleAt = performance.now();
  const elapsedMicros = Math.max(1, (currentSampleAt - previousCpuSampleAt) * 1000);
  const cpuDelta = process.cpuUsage(previousCpuUsage);
  const cpuDeltaTotal = cpuDelta.user + cpuDelta.system;
  const percentOfOneCore = (cpuDeltaTotal / elapsedMicros) * 100;

  previousCpuUsage = currentCpuUsage;
  previousCpuSampleAt = currentSampleAt;

  const eventLoopMetrics = {
    count: eventLoopDelay.count,
    minMs: nanosecondsToMs(eventLoopDelay.min),
    avgMs: nanosecondsToMs(eventLoopDelay.mean),
    maxMs: nanosecondsToMs(eventLoopDelay.max),
    stddevMs: nanosecondsToMs(eventLoopDelay.stddev),
    p50Ms: nanosecondsToMs(eventLoopDelay.percentile(50)),
    p95Ms: nanosecondsToMs(eventLoopDelay.percentile(95)),
    p99Ms: nanosecondsToMs(eventLoopDelay.percentile(99)),
  };
  eventLoopDelay.reset();

  return {
    eventLoopDelay: eventLoopMetrics,
    cpu: {
      cores: cpuCount,
      userMicros: currentCpuUsage.user,
      systemMicros: currentCpuUsage.system,
      percentOfOneCore: round(percentOfOneCore),
      percentOfSystem: round(percentOfOneCore / cpuCount),
    },
  };
}

export function getDbQueryLatencyMetrics(): DbQueryLatencyMetrics {
  const percentiles = calculatePercentiles(dbQueryLatencySamples);
  return {
    count: dbQueryCount,
    avgMs: dbQueryCount > 0 ? round(dbQueryTotalMs / dbQueryCount) : 0,
    maxMs: round(dbQueryMaxMs),
    p50Ms: percentiles.p50Ms,
    p95Ms: percentiles.p95Ms,
    p99Ms: percentiles.p99Ms,
    recentSampleSize: dbQueryLatencySamples.length,
    lastQueryAt: dbLastQueryAt,
  };
}

export function getSocketDisconnectMetrics(): SocketDisconnectMetrics {
  return {
    total: socketDisconnectTotal,
    serverCaused: socketDisconnectServerCaused,
    clientCaused: socketDisconnectClientCaused,
    byReason: mapToSortedRecord(socketDisconnectsByReason),
    byRole: mapToSortedRecord(socketDisconnectsByRole),
  };
}

function calculatePercentiles(samples: number[]): Pick<LatencyStats, 'p50Ms' | 'p95Ms' | 'p99Ms'> {
  if (samples.length === 0) {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
  };
}

function percentile(sortedSamples: number[], percentileValue: number): number {
  const index = Math.min(
    sortedSamples.length - 1,
    Math.max(0, Math.ceil(sortedSamples.length * percentileValue) - 1)
  );
  return sortedSamples[index] ?? 0;
}

function nanosecondsToMs(value: number): number {
  if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) return 0;
  return round(value / 1_000_000);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapToSortedRecord(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}
