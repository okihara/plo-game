/**
 * 特設ページ用のシーズン結果ペイロード（season / stats / ranking / awards）を組み立てる。
 *
 * - ライブ集計（API のフォールバック）とスナップショット生成スクリプトの双方から再利用する。
 * - 集計は全ハンド走査でやや重い（数十秒）。シーズン確定後は generate-season-snapshot.ts で
 *   一度だけ実行して SeasonSnapshot に保存し、API はそれを即返す。
 */
import type { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from './seasonConfig.js';
import { computeSeasonRanking } from './computeSeasonRanking.js';
import { computeSeasonAwards, type Award } from './computeSeasonAwards.js';

const TOP_N = 30;

export interface SeasonRankEntry {
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

export interface SeasonPayload {
  season: { name: string; label: string; start: string; end: string };
  stats: { tournaments: number; rankedPlayers: number; totalEntries: number; handsScanned: number };
  ranking: SeasonRankEntry[];
  awards: Award[];
}

export async function buildSeasonPayload(prisma: PrismaClient): Promise<SeasonPayload> {
  const [{ ranking, tournamentsCounted }, awardsResult] = await Promise.all([
    computeSeasonRanking(prisma),
    computeSeasonAwards(prisma),
  ]);

  const topRanking = ranking.slice(0, TOP_N);

  const users = await prisma.user.findMany({
    where: { id: { in: topRanking.map((u) => u.userId) } },
    select: { id: true, avatarUrl: true, twitterAvatarUrl: true, useTwitterAvatar: true },
  });
  const avatarById = new Map(
    users.map((u) => [u.id, u.useTwitterAvatar && u.twitterAvatarUrl ? u.twitterAvatarUrl : u.avatarUrl ?? null]),
  );

  const totalEntries = ranking.reduce((s, u) => s + u.entries, 0);

  return {
    season: {
      name: CURRENT_SEASON.name,
      label: CURRENT_SEASON.label,
      start: CURRENT_SEASON.start.toISOString(),
      end: CURRENT_SEASON.end.toISOString(),
    },
    stats: {
      tournaments: tournamentsCounted,
      rankedPlayers: ranking.length,
      totalEntries,
      handsScanned: awardsResult.handsScanned,
    },
    ranking: topRanking.map((u, i) => ({
      position: i + 1,
      userId: u.userId,
      name: u.name,
      avatarUrl: avatarById.get(u.userId) ?? null,
      totalRp: u.totalRp,
      entries: u.entries,
      wins: u.wins,
      itm: u.itm,
      best: u.best === Infinity ? null : u.best,
    })),
    awards: awardsResult.awards,
  };
}
