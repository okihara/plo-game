import type { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../../config/database.js';
import { CURRENT_SEASON, RESULT_SEASON, SEASONS, findSeasonById, type SeasonConfig } from './seasonConfig.js';
import { buildSeasonPayload, type SeasonFullData } from './buildSeasonPayload.js';

// シーズン確定後はスナップショット（SeasonSnapshot）を即返す。
// スナップショット未生成の間（シーズン中のプレビュー）は重いライブ集計に
// フォールバックし、stale-while-revalidate でリクエストをブロックしない。
// 過去シーズンは ?s=<シーズン番号> で指定する（省略時は RESULT_SEASON）。

const SNAPSHOT_CACHE_TTL_MS = 5 * 60_000; // スナップショットのDB読み込み結果のメモリ保持
const LIVE_CACHE_TTL_MS = 30 * 60_000; // ライブ集計結果のメモリ保持
const LIST_CACHE_TTL_MS = 5 * 60_000; // アーカイブ一覧のメモリ保持

const snapshotCache = new Map<string, { data: SeasonFullData; expiresAt: number }>();

let liveCache: SeasonFullData | null = null;
let liveCachedAt = 0;
let liveComputing: Promise<void> | null = null;

let listCache: { seasons: SeasonSummary[]; expiresAt: number } | null = null;

interface SeasonSummary {
  id: number;
  name: string;
  label: string;
}

async function readSnapshot(season: SeasonConfig): Promise<SeasonFullData | null> {
  const cached = snapshotCache.get(season.name);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  const row = await prisma.seasonSnapshot.findUnique({ where: { seasonName: season.name } });
  if (!row) return null;
  const data = row.data as unknown as SeasonFullData;
  snapshotCache.set(season.name, { data, expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS });
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
async function getSeasonData(season: SeasonConfig): Promise<SeasonFullData | null> {
  const snapshot = await readSnapshot(season);
  if (snapshot) return snapshot;

  // ライブ集計は CURRENT_SEASON を対象にするため、それ以外のシーズンで
  // フォールバックすると違うシーズンの結果を出してしまう。
  if (season.name !== CURRENT_SEASON.name) return null;

  const isFresh = liveCache && Date.now() - liveCachedAt < LIVE_CACHE_TTL_MS;
  if (!isFresh) void refreshLive();
  return liveCache; // 初回集計中は null
}

/** 公開できるシーズン（RESULT_SEASON まで、かつ中身を返せるもの）を古い順に返す */
async function listSeasons(): Promise<SeasonSummary[]> {
  if (listCache && Date.now() < listCache.expiresAt) return listCache.seasons;

  const publishable = SEASONS.filter(s => s.id <= RESULT_SEASON.id);
  const rows = await prisma.seasonSnapshot.findMany({ select: { seasonName: true } });
  const withSnapshot = new Set(rows.map(r => r.seasonName));
  const seasons = publishable
    // スナップショット未生成でも進行中シーズンはライブ集計で返せる
    .filter(s => withSnapshot.has(s.name) || s.name === CURRENT_SEASON.name)
    .map(s => ({ id: s.id, name: s.name, label: s.label }));

  listCache = { seasons, expiresAt: Date.now() + LIST_CACHE_TTL_MS };
  return seasons;
}

/** クエリ ?s=<シーズン番号> で表示シーズンを指定（省略時は RESULT_SEASON）。未知・未公開は null。 */
function resolveSeason(request: FastifyRequest): SeasonConfig | null {
  const { s } = request.query as { s?: string };
  if (s === undefined || s === '') return RESULT_SEASON;
  const season = findSeasonById(s);
  // まだ結果を公開していないシーズンは指定できない
  if (!season || season.id > RESULT_SEASON.id) return null;
  return season;
}

export async function seasonRoutes(fastify: FastifyInstance) {
  // 公開済みシーズンの一覧（特設ページのシーズン切替タブ用）
  fastify.get('/list', async () => {
    return { seasons: await listSeasons() };
  });

  // 公開ランキング＋アワード（players は本人ページ専用なので省く）
  fastify.get('/', async (request, reply) => {
    const season = resolveSeason(request);
    if (!season) return reply.code(404).send({ error: 'unknown season' });
    const data = await getSeasonData(season);
    if (!data) return reply.code(202).send({ ready: false });
    const { players: _players, ...pub } = data;
    return { ready: true, ...pub };
  });

  // 閲覧者本人の個人データ（スマブラ戦績風）
  fastify.get('/player/:userId', async (request: FastifyRequest, reply) => {
    const { userId } = request.params as { userId: string };
    const season = resolveSeason(request);
    if (!season) return reply.code(404).send({ error: 'unknown season' });
    const data = await getSeasonData(season);
    if (!data) return reply.code(202).send({ ready: false });
    return { ready: true, player: data.players?.[userId] ?? null };
  });
}
