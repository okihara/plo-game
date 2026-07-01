/**
 * 特設ページ用のシーズン結果データ（season / stats / ranking / awards / players）を組み立てる。
 *
 * - ライブ集計（API のフォールバック）とスナップショット生成スクリプトの双方から再利用する。
 * - 集計は全ハンド走査でやや重い（数十秒）。シーズン確定後は generate-season-snapshot.ts で
 *   一度だけ実行して SeasonSnapshot に保存し、API はそれを即返す。
 * - `players` は閲覧者本人の個人データセクション用。全プレイヤーの個人記録＋各賞での順位を保持し、
 *   公開ランキング応答（GET /api/season）では省き、GET /api/season/player/:userId で本人ぶんだけ返す。
 */
import type { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from './seasonConfig.js';
import { computeSeasonRanking } from './computeSeasonRanking.js';
import { computeSeasonAwards, type Award, type MateRef } from './computeSeasonAwards.js';

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

export interface SeasonAwardRank {
  key: string;
  title: string;
  emoji: string;
  rank: number;
  total: number;
  valueLabel: string;
}

/** 閲覧者本人の個人データ（スマブラ戦績風） */
export interface SeasonPlayerStats {
  userId: string;
  rpRank: number | null; // RPランキング内の順位（RP0=ランク外は null）
  totalRp: number;
  // トーナメント成績
  tournaments: number;
  entries: number;
  reentries: number;
  wins: number;
  itm: number;
  best: number | null;
  totalRoi: number | null; // 総ROI（%）= (Σ獲得賞金 − Σバイイン) / Σバイイン × 100
  avgRoi: number | null; // 平均ROI（%）= 各トナメのROIを回数で平均
  // ハンドスタッツ（トナメ×シーズン期間）
  hands: number;
  vpip: number | null;
  pfr: number | null;
  afq: number | null;
  threeBet: number | null;
  wsd: number | null;
  allinHands: number;
  allinWins: number;
  allinWinRate: number | null;
  maxPotWon: number;
  knockouts: number;
  // よく対戦したプレイヤー
  topTableMate: MateRef | null;
  topHuMate: MateRef | null;
  // 各賞での順位（全国○位の演出）
  awardRanks: SeasonAwardRank[];
}

export interface SeasonPayload {
  season: { name: string; label: string; start: string; end: string };
  stats: { tournaments: number; participants: number; rankedPlayers: number; totalEntries: number; handsScanned: number };
  ranking: SeasonRankEntry[];
  awards: Award[];
}

/** SeasonPayload に全プレイヤーの個人記録を加えた、DB/メモリに保持する完全形 */
export interface SeasonFullData extends SeasonPayload {
  players: Record<string, SeasonPlayerStats>;
}

export async function buildSeasonPayload(prisma: PrismaClient): Promise<SeasonFullData> {
  const [{ ranking, tournamentsCounted }, awardsResult] = await Promise.all([
    computeSeasonRanking(prisma),
    computeSeasonAwards(prisma),
  ]);
  const { awards, rankings, participation, statsByUser, handsScanned } = awardsResult;

  const topRanking = ranking.slice(0, TOP_N);

  const users = await prisma.user.findMany({
    where: { id: { in: topRanking.map((u) => u.userId) } },
    select: { id: true, avatarUrl: true, twitterAvatarUrl: true, useTwitterAvatar: true },
  });
  const avatarById = new Map(
    users.map((u) => [u.id, u.useTwitterAvatar && u.twitterAvatarUrl ? u.twitterAvatarUrl : u.avatarUrl ?? null]),
  );

  const totalEntries = ranking.reduce((s, u) => s + u.entries, 0);

  // RPランキング内順位の逆引き
  const rankPos = new Map<string, number>();
  const rankRp = new Map<string, number>();
  ranking.forEach((u, i) => {
    rankPos.set(u.userId, i + 1);
    rankRp.set(u.userId, u.totalRp);
  });

  // プレイヤー別の個人記録を構築（参加 or ハンドのどちらかがあれば対象）
  const players: Record<string, SeasonPlayerStats> = {};
  const allIds = new Set<string>([...participation.keys(), ...statsByUser.keys()]);
  for (const uid of allIds) {
    const p = participation.get(uid);
    const s = statsByUser.get(uid);

    const awardRanks: SeasonAwardRank[] = [];
    for (const r of rankings) {
      const idx = r.ranked.findIndex((e) => e.userId === uid);
      if (idx >= 0) {
        awardRanks.push({
          key: r.key,
          title: r.title,
          emoji: r.emoji,
          rank: idx + 1,
          total: r.ranked.length,
          valueLabel: r.ranked[idx].valueLabel,
        });
      }
    }

    players[uid] = {
      userId: uid,
      rpRank: rankPos.get(uid) ?? null,
      totalRp: rankRp.get(uid) ?? 0,
      tournaments: p?.tournaments ?? 0,
      entries: p?.entries ?? 0,
      reentries: p?.reentries ?? 0,
      wins: p?.wins ?? 0,
      itm: p?.itm ?? 0,
      best: p && p.best !== Infinity ? p.best : null,
      totalRoi: p && p.invested > 0 ? ((p.returned - p.invested) / p.invested) * 100 : null,
      avgRoi: p && p.roiCount > 0 ? (p.roiSum / p.roiCount) * 100 : null,
      hands: s?.hands ?? 0,
      vpip: s?.vpip ?? null,
      pfr: s?.pfr ?? null,
      afq: s?.afq ?? null,
      threeBet: s?.threeBet ?? null,
      wsd: s?.wsd ?? null,
      allinHands: s?.allinHands ?? 0,
      allinWins: s?.allinWins ?? 0,
      allinWinRate: s && s.allinHands > 0 ? (s.allinWins / s.allinHands) * 100 : null,
      maxPotWon: s?.maxPotWon ?? 0,
      knockouts: s?.knockouts ?? 0,
      topTableMate: s?.topTableMate ?? null,
      topHuMate: s?.topHuMate ?? null,
      awardRanks,
    };
  }

  return {
    season: {
      name: CURRENT_SEASON.name,
      label: CURRENT_SEASON.label,
      start: CURRENT_SEASON.start.toISOString(),
      end: CURRENT_SEASON.end.toISOString(),
    },
    stats: {
      tournaments: tournamentsCounted,
      participants: participation.size,
      rankedPlayers: ranking.length,
      totalEntries,
      handsScanned,
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
    awards,
    players,
  };
}
