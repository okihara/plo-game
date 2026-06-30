import type { FastifyInstance } from 'fastify';
import { prisma } from '../../config/database.js';
import { CURRENT_SEASON } from './seasonConfig.js';
import { buildSeasonPayload, type SeasonPayload } from './buildSeasonPayload.js';

// シーズン確定後はスナップショット（SeasonSnapshot）を即返す。
// スナップショット未生成の間（シーズン中のプレビュー）は重いライブ集計に
// フォールバックし、stale-while-revalidate でリクエストをブロックしない。

const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000; // スナップショットのDB読み込み結果のメモリ保持
const LIVE_CACHE_TTL_MS = 30 * 60_000; // ライブ集計結果のメモリ保持

let snapshotCache: { data: SeasonPayload; expiresAt: number } | null = null;

let liveCache: SeasonPayload | null = null;
let liveCachedAt = 0;
let liveComputing: Promise<void> | null = null;

async function readSnapshot(): Promise<SeasonPayload | null> {
  if (snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.data;
  }
  const row = await prisma.seasonSnapshot.findUnique({ where: { seasonName: CURRENT_SEASON.name } });
  if (!row) return null;
  const data = row.data as unknown as SeasonPayload;
  snapshotCache = { data, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS };
  return data;
}

function refreshLive(): Promise<void> {
  if (liveComputing) return liveComputing;
  liveComputing = buildSeasonPayload(prisma)
    .then((data) => {
      liveCache = data;
      liveCachedAt = Date.now();
    })
    .catch((err) => {
      console.error('[season] ライブ集計に失敗しました:', err);
    })
    .finally(() => {
      liveComputing = null;
    });
  return liveComputing;
}

export async function seasonRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    // 1. スナップショットがあれば最優先で即返す（確定後の通常運用）
    const snapshot = await readSnapshot();
    if (snapshot) {
      return { ready: true, ...snapshot };
    }

    // 2. スナップショット未生成 → ライブ集計にフォールバック（stale-while-revalidate）
    const isFresh = liveCache && Date.now() - liveCachedAt < LIVE_CACHE_TTL_MS;
    if (!isFresh) {
      void refreshLive();
    }
    if (liveCache) {
      return { ready: true, ...liveCache };
    }

    // 3. 初回集計中はまだデータがない → フロントはポーリングして待つ
    return reply.code(202).send({ ready: false });
  });
}
