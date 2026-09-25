/**
 * 賞金ベースの RP（ランクポイント）ルールでシーズン内の完了トナメを集計し、通算ランキングを返す。
 *
 * 集計ルール（rank-points-ranking スクリプトと共通の正）:
 *   - 対象: シーズン期間内（CURRENT_SEASON.start 〜 end）に completedAt がある COMPLETED トナメ
 *   - 総エントリー数 N = results.length + sum(reentries)（Bot含む）
 *   - 賞金分配 = 現行の PrizeCalculator デフォルトルール（上位15%ペイアウト）を一律適用して再算定
 *   - RP = ceil(再算定後の賞金額 / 1000)。賞金 0 円なら 0RP
 *   - Bot (User.provider='bot') はランキングから除外（エントリー数には含める）
 *   - 順位は同RPなら同順位（1, 2, 2, 4 …の競技方式）。並び順は同RP内で出場数が少ない方が先
 */
import type { PrismaClient } from '@prisma/client';
import { maskName } from '../../shared/utils.js';
import { PrizeCalculator } from '../tournament/PrizeCalculator.js';
import { CURRENT_SEASON } from './seasonConfig.js';

export function rpFromAmount(amount: number): number {
  if (amount <= 0) return 0;
  return Math.ceil(amount / 1000);
}

export interface UserRankAgg {
  userId: string;
  name: string;
  provider: string;
  totalRp: number;
  entries: number;
  wins: number;
  itm: number;
  best: number;
  totalPrize: number;
}

/** 順位つきのランキング行。同RPは同じ position になる */
export interface RankedUser extends UserRankAgg {
  position: number;
}

export interface SeasonTournamentRow {
  id: string;
  name: string;
  completedAt: Date | null;
  prizePool: number;
  buyIn: number;
  results: {
    userId: string;
    position: number;
    prize: number;
    reentries: number;
    user: { username: string; displayName: string | null; provider: string; nameMasked: boolean };
  }[];
}

export interface SeasonRankingResult {
  ranking: RankedUser[];
  tournamentsCounted: number;
  tournamentsSkipped: number;
}

export function resolveDisplayName(user: { username: string; displayName: string | null; nameMasked: boolean }): string {
  if (user.displayName) return user.displayName;
  return user.nameMasked ? maskName(user.username) : user.username;
}

/**
 * RP 降順に並んだ行へ順位を振る。同RPは同順位で、次の順位は人数分飛ぶ（100, 90, 90, 80 → 1, 2, 2, 4）。
 */
export function assignPositions<T extends { totalRp: number }>(sorted: T[]): (T & { position: number })[] {
  let position = 0;
  return sorted.map((u, i) => {
    if (i === 0 || u.totalRp !== sorted[i - 1].totalRp) position = i + 1;
    return { ...u, position };
  });
}

/** 順位が n 位以内の行を返す（n 位に同点が複数いれば全員含むので n 件を超えることがある） */
export function takeTop<T extends { position: number }>(ranked: T[], n: number): T[] {
  return ranked.filter((u) => u.position <= n);
}

export function fetchSeasonTournaments(prisma: PrismaClient): Promise<SeasonTournamentRow[]> {
  return prisma.tournament.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: CURRENT_SEASON.start, lte: CURRENT_SEASON.end },
    },
    select: {
      id: true,
      name: true,
      completedAt: true,
      prizePool: true,
      buyIn: true,
      results: {
        select: {
          userId: true,
          position: true,
          prize: true,
          reentries: true,
          user: { select: { username: true, displayName: true, provider: true, nameMasked: true } },
        },
      },
    },
  });
}

export function aggregateRanking(tournaments: SeasonTournamentRow[]): SeasonRankingResult {
  const agg = new Map<string, UserRankAgg>();
  let tournamentsCounted = 0;
  let tournamentsSkipped = 0;

  for (const t of tournaments) {
    const totalEntries = t.results.length + t.results.reduce((s, r) => s + (r.reentries ?? 0), 0);
    if (totalEntries < 2) {
      tournamentsSkipped++;
      continue;
    }
    tournamentsCounted++;

    const prizes = PrizeCalculator.calculate(totalEntries, t.prizePool);
    const amountByPosition = new Map<number, number>(prizes.map((p) => [p.position, p.amount]));
    const itmCount = prizes.length;

    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      const amount = amountByPosition.get(r.position) ?? 0;
      const rp = rpFromAmount(amount);
      const cur = agg.get(r.userId) ?? {
        userId: r.userId,
        name: resolveDisplayName(r.user),
        provider: r.user.provider,
        totalRp: 0,
        entries: 0,
        wins: 0,
        itm: 0,
        best: Infinity,
        totalPrize: 0,
      };
      cur.totalRp += rp;
      cur.entries += 1;
      if (r.position === 1) cur.wins += 1;
      if (r.position <= itmCount) cur.itm += 1;
      if (r.position < cur.best) cur.best = r.position;
      cur.totalPrize += amount;
      agg.set(r.userId, cur);
    }
  }

  const ranking = assignPositions(
    Array.from(agg.values())
      .filter((u) => u.totalRp > 0)
      .sort((a, b) => b.totalRp - a.totalRp || a.entries - b.entries),
  );

  return { ranking, tournamentsCounted, tournamentsSkipped };
}

/** シーズンの RP ランキングを集計して返す（DB から取得 → 集計）。 */
export async function computeSeasonRanking(prisma: PrismaClient): Promise<SeasonRankingResult & { tournaments: SeasonTournamentRow[] }> {
  const tournaments = await fetchSeasonTournaments(prisma);
  return { ...aggregateRanking(tournaments), tournaments };
}

// ============================================
// 最新トナメ前後の順位差分（ランキングツイート用）
// ============================================

export interface RankingDiffEntry {
  position: number;
  userId: string;
  name: string;
  totalRp: number;
  rpGained: number;
  entries: number;
  wins: number;
  itm: number;
  best: number | null;
  previousPosition: number | null;
  /** +N でランクアップ */
  positionDelta: number | null;
  isNewToTop: boolean;
}

export interface RankingParticipantChange {
  userId: string;
  name: string;
  currentPosition: number;
  previousPosition: number | null;
  positionDelta: number | null;
  totalRp: number;
  rpGained: number;
}

export interface RankingDiff {
  latestTournament: {
    id: string;
    name: string;
    completedAt: string | null;
    entries: number;
  };
  totals: {
    currentRankedUsers: number;
    previousRankedUsers: number;
  };
  top: RankingDiffEntry[];
  participants: RankingParticipantChange[];
  /** シーズン進捗表示用: 集計対象になった完了トナメ数 */
  tournamentsCounted: number;
}

/**
 * 「最新の完了トナメを除いた集計」との差分を返す。
 * 完了トナメが2本未満で差分が定義できないときは null（呼び出し側でスキップ）。
 */
export function computeRankingDiff(
  tournaments: SeasonTournamentRow[],
  topN: number,
): RankingDiff | null {
  const ranked = tournaments
    .filter((t) => t.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  if (ranked.length < 2) return null;

  const latest = ranked[0];
  const prevTournaments = tournaments.filter((t) => t.id !== latest.id);

  const currentResult = aggregateRanking(tournaments);
  const current = currentResult.ranking;
  const previous = aggregateRanking(prevTournaments).ranking;

  const currentPos = new Map<string, number>(current.map((u) => [u.userId, u.position]));
  const previousPos = new Map<string, number>(previous.map((u) => [u.userId, u.position]));
  const previousRp = new Map<string, number>(previous.map((u) => [u.userId, u.totalRp]));

  const topEntries: RankingDiffEntry[] = takeTop(current, topN).map((u) => {
    const pos = u.position;
    const prevPos = previousPos.get(u.userId) ?? null;
    const prevRp = previousRp.get(u.userId) ?? 0;
    return {
      position: pos,
      userId: u.userId,
      name: u.name,
      totalRp: u.totalRp,
      rpGained: u.totalRp - prevRp,
      entries: u.entries,
      wins: u.wins,
      itm: u.itm,
      best: u.best === Infinity ? null : u.best,
      previousPosition: prevPos,
      positionDelta: prevPos === null ? null : prevPos - pos,
      isNewToTop: prevPos === null || prevPos > topN,
    };
  });

  // 参加者のRP獲得を抽出（順位圏外の人も含めて、最新トナメでRPを獲得した人）
  const latestParticipants = new Set(
    latest.results.filter((r) => r.user.provider !== 'bot').map((r) => r.userId)
  );
  const participants: RankingParticipantChange[] = current
    .filter((u) => latestParticipants.has(u.userId))
    .map((u) => {
      const pos = currentPos.get(u.userId)!;
      const prevPos = previousPos.get(u.userId) ?? null;
      const prevRp = previousRp.get(u.userId) ?? 0;
      return {
        userId: u.userId,
        name: u.name,
        currentPosition: pos,
        previousPosition: prevPos,
        positionDelta: prevPos === null ? null : prevPos - pos,
        totalRp: u.totalRp,
        rpGained: u.totalRp - prevRp,
      };
    })
    .sort((a, b) => b.rpGained - a.rpGained);

  return {
    latestTournament: {
      id: latest.id,
      name: latest.name,
      completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
      entries: latest.results.length,
    },
    totals: {
      currentRankedUsers: current.length,
      previousRankedUsers: previous.length,
    },
    top: topEntries,
    participants,
    tournamentsCounted: currentResult.tournamentsCounted,
  };
}
