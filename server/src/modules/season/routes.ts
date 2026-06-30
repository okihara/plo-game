import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { CURRENT_SEASON } from './seasonConfig.js';
import { buildSeasonPayload, type SeasonFullData } from './buildSeasonPayload.js';

// シーズン確定後はスナップショット（SeasonSnapshot）を即返す。
// スナップショット未生成の間（シーズン中のプレビュー）は重いライブ集計に
// フォールバックし、stale-while-revalidate でリクエストをブロックしない。

const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000; // スナップショットのDB読み込み結果のメモリ保持
const LIVE_CACHE_TTL_MS = 30 * 60_000; // ライブ集計結果のメモリ保持

let snapshotCache: { data: SeasonFullData; expiresAt: number } | null = null;

let liveCache: SeasonFullData | null = null;
let liveCachedAt = 0;
let liveComputing: Promise<void> | null = null;

async function readSnapshot(): Promise<SeasonFullData | null> {
  if (snapshotCache && Date.now() < snapshotCache.expiresAt) {
    return snapshotCache.data;
  }
  const row = await prisma.seasonSnapshot.findUnique({ where: { seasonName: CURRENT_SEASON.name } });
  if (!row) return null;
  const data = row.data as unknown as SeasonFullData;
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

/** スナップショット優先・ライブ集計フォールバックで完全データを取得（なければ null） */
async function getSeasonData(): Promise<SeasonFullData | null> {
  const snapshot = await readSnapshot();
  if (snapshot) return snapshot;

  const isFresh = liveCache && Date.now() - liveCachedAt < LIVE_CACHE_TTL_MS;
  if (!isFresh) void refreshLive();
  return liveCache; // 初回集計中は null
}

export async function seasonRoutes(fastify: FastifyInstance) {
  // 公開ランキング＋アワード（players は本人ページ専用なので省く）
  fastify.get('/', async (_request, reply) => {
    const data = await getSeasonData();
    if (!data) return reply.code(202).send({ ready: false });
    const { players: _players, ...pub } = data;
    return { ready: true, ...pub };
  });

  // 閲覧者本人の個人データ（スマブラ戦績風）
  fastify.get('/player/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };
    const data = await getSeasonData();
    if (!data) return reply.code(202).send({ ready: false });
    return { ready: true, player: data.players?.[userId] ?? null };
  });
}
