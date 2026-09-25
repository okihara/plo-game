/**
 * 進行中シーズン（CURRENT_SEASON）の RP ランキングをライブで返す。
 *
 * /season 特設ページ（確定シーズンのスナップショット）とは別物で、
 * ハンド走査を伴わない軽量集計（完了トナメの結果のみ）なので短い TTL で都度作り直す。
 * TOP30 に入っていない人でも自分の順位と前後の順位を確認できるようにするのが目的。
 */
import type { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from './seasonConfig.js';
import { computeSeasonRanking, takeTop, type RankedUser } from './computeSeasonRanking.js';
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
  /** ひとつ上の順位に並ぶのに必要な RP（1位なら null） */
  rpToNext: number | null;
  /** TOP30 入り（30位に並ぶ）に必要な RP（既に TOP30 内なら null） */
  rpToTop: number | null;
}

export interface LiveRankingView {
  season: { id: number; name: string; label: string };
  tournamentsCounted: number;
  rankedPlayers: number;
  /** TOP 何位まで top に載せるか（見出し・「TOP◯◯まであと」表示用） */
  topN: number;
  /** topN 位以内の全員（同順位がいれば topN 人を超える） */
  top: LiveRankEntry[];
  /** 自分が TOP30 圏外のとき、自分の前後 LIVE_RANKING_AROUND 人（自分含む）。圏内・未ランクなら空 */
  around: LiveRankEntry[];
  /** userId 指定時の自分の順位。RP 未獲得なら null */
  me: LiveRankingMe | null;
}

type RankRow = Omit<LiveRankEntry, 'avatarUrl'>;

function toRow(u: RankedUser): RankRow {
  return {
    position: u.position,
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
 * 順位つきランキング（aggregateRanking の結果）から表示用ビュー（アバター抜き）を組み立てる純粋関数。
 * 同RPは同順位なので、「ひとつ上」は自分より RP が多い中で最も近い順位を指す。
 */
export function buildLiveRankingRows(
  ranking: RankedUser[],
  userId: string | undefined,
  topN = LIVE_RANKING_TOP_N,
  aroundRadius = LIVE_RANKING_AROUND,
): { top: RankRow[]; around: RankRow[]; me: (RankRow & { rpToNext: number | null; rpToTop: number | null }) | null } {
  const rows = ranking.map(toRow);
  const top = takeTop(rows, topN);

  const myIndex = userId ? rows.findIndex((r) => r.userId === userId) : -1;
  if (myIndex < 0) return { top, around: [], me: null };

  const mine = rows[myIndex];
  // 自分と同順位の先頭のひとつ前 = 自分より RP が多い中で最も近い人
  const above = mine.position > 1 ? rows[mine.position - 2] : null;
  const inTop = mine.position <= topN;
  // 圏外なら TOP 最下位（topN 番目の行）の RP に並べば圏内
  const topBorder = rows[topN - 1];
  const me = {
    ...mine,
    rpToNext: above ? above.totalRp - mine.totalRp : null,
    rpToTop: !inTop && topBorder ? topBorder.totalRp - mine.totalRp : null,
  };

  const around = inTop
    ? []
    : rows.slice(Math.max(top.length, myIndex - aroundRadius), myIndex + aroundRadius + 1);

  return { top, around, me };
}

interface RankingCache {
  ranking: RankedUser[];
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
