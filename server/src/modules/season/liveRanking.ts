/**
 * 進行中シーズン（CURRENT_SEASON）の RP ランキングをライブで返す。
 *
 * /season 特設ページ（確定シーズンのスナップショット）とは別物で、
 * ハンド走査を伴わない軽量集計（完了トナメの結果のみ）なので短い TTL で都度作り直す。
 * TOP30 に入っていない人でも自分の順位と前後の順位を確認できるようにするのが目的。
 */
import type { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from './seasonConfig.js';
import { computeSeasonRanking, type UserRankAgg } from './computeSeasonRanking.js';
import { fetchAvatarUrls } from './avatar.js';

export const LIVE_RANKING_TOP_N = 30;
/** 自分の前後に何人ずつ表示するか */
export const LIVE_RANKING_AROUND = 2;

const CACHE_TTL_MS = 60_000;

export interface LiveRankEntry {
  position: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  totalRp: number;
  entries: number;
  wins: number;
  itm: number;
  best: number | null;
}

export interface LiveRankingMe extends LiveRankEntry {
  /** ひとつ上の順位に並ぶ/抜くのに必要な RP（1位なら null） */
  rpToNext: number | null;
  /** TOP30 入りに必要な RP（既に TOP30 内なら null） */
  rpToTop: number | null;
}

export interface LiveRankingView {
  season: { id: number; name: string; label: string };
  tournamentsCounted: number;
  rankedPlayers: number;
  /** TOP 何位まで top に載せるか（見出し・「TOP◯◯まであと」表示用） */
  topN: number;
  top: LiveRankEntry[];
  /** 自分が TOP30 圏外のとき、自分の前後 LIVE_RANKING_AROUND 人（自分含む）。圏内・未ランクなら空 */
  around: LiveRankEntry[];
  /** userId 指定時の自分の順位。RP 未獲得なら null */
  me: LiveRankingMe | null;
}

type RankRow = Omit<LiveRankEntry, 'avatarUrl'>;

function toRow(u: UserRankAgg, index: number): RankRow {
  return {
    position: index + 1,
    userId: u.userId,
    name: u.name,
    totalRp: u.totalRp,
    entries: u.entries,
    wins: u.wins,
    itm: u.itm,
    best: u.best === Infinity ? null : u.best,
  };
}

/**
 * ソート済みランキングから表示用ビュー（アバター抜き）を組み立てる純粋関数。
 * 順位は aggregateRanking の並び順（RP 降順・同点はエントリー少ない順）の index + 1。
 */
export function buildLiveRankingRows(
  ranking: UserRankAgg[],
  userId: string | undefined,
  topN = LIVE_RANKING_TOP_N,
  aroundRadius = LIVE_RANKING_AROUND,
): { top: RankRow[]; around: RankRow[]; me: (RankRow & { rpToNext: number | null; rpToTop: number | null }) | null } {
  const rows = ranking.map(toRow);
  const top = rows.slice(0, topN);

  const myIndex = userId ? rows.findIndex((r) => r.userId === userId) : -1;
  if (myIndex < 0) return { top, around: [], me: null };

  const mine = rows[myIndex];
  const above = myIndex > 0 ? rows[myIndex - 1] : null;
  const topBorder = rows[topN - 1];
  const me = {
    ...mine,
    rpToNext: above ? above.totalRp - mine.totalRp : null,
    rpToTop: myIndex >= topN && topBorder ? topBorder.totalRp - mine.totalRp : null,
  };

  const around = myIndex >= topN
    ? rows.slice(Math.max(topN, myIndex - aroundRadius), myIndex + aroundRadius + 1)
    : [];

  return { top, around, me };
}

interface RankingCache {
  ranking: UserRankAgg[];
  tournamentsCounted: number;
  expiresAt: number;
}

let cache: RankingCache | null = null;
let computing: Promise<RankingCache> | null = null;

async function getRanking(prisma: PrismaClient): Promise<RankingCache> {
  if (cache && Date.now() < cache.expiresAt) return cache;
  if (computing) return computing;
  computing = computeSeasonRanking(prisma)
    .then(({ ranking, tournamentsCounted }) => {
      const fresh: RankingCache = { ranking, tournamentsCounted, expiresAt: Date.now() + CACHE_TTL_MS };
      cache = fresh;
      return fresh;
    })
    .finally(() => {
      computing = null;
    });
  return computing;
}

export async function getLiveRanking(prisma: PrismaClient, userId: string | undefined): Promise<LiveRankingView> {
  const { ranking, tournamentsCounted } = await getRanking(prisma);
  const { top, around, me } = buildLiveRankingRows(ranking, userId);

  const avatarById = await fetchAvatarUrls(prisma, [...top, ...around].map((r) => r.userId));
  const withAvatar = (r: RankRow): LiveRankEntry => ({ ...r, avatarUrl: avatarById.get(r.userId) ?? null });

  return {
    season: { id: CURRENT_SEASON.id, name: CURRENT_SEASON.name, label: CURRENT_SEASON.label },
    tournamentsCounted,
    rankedPlayers: ranking.length,
    topN: LIVE_RANKING_TOP_N,
    top: top.map(withAvatar),
    around: around.map(withAvatar),
    me: me ? { ...me, avatarUrl: avatarById.get(me.userId) ?? null } : null,
  };
}
