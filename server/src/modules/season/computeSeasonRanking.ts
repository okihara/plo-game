/**
 * 賞金ベースの RP（ランクポイント）ルールでシーズン内の完了トナメを集計し、通算ランキングを返す。
 *
 * 集計ルール（rank-points-ranking スクリプトと共通の正）:
 *   - 対象: シーズン期間内（CURRENT_SEASON.start 〜 end）に completedAt がある COMPLETED トナメ
 *   - 総エントリー数 N = results.length + sum(reentries)（Bot含む）
 *   - 賞金分配 = 現行の PrizeCalculator デフォルトルール（上位15%ペイアウト）を一律適用して再算定
 *   - RP = ceil(再算定後の賞金額 / 1000)。賞金 0 円なら 0RP
 *   - Bot (User.provider='bot') はランキングから除外（エントリー数には含める）
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

export interface SeasonTournamentRow {
  id: string;
  name: string;
  completedAt: Date | null;
  prizePool: number;
  results: {
    userId: string;
    position: number;
    prize: number;
    reentries: number;
    user: { username: string; displayName: string | null; provider: string; nameMasked: boolean };
  }[];
}

export interface SeasonRankingResult {
  ranking: UserRankAgg[];
  tournamentsCounted: number;
  tournamentsSkipped: number;
}

export function resolveDisplayName(user: { username: string; displayName: string | null; nameMasked: boolean }): string {
  if (user.displayName) return user.displayName;
  return user.nameMasked ? maskName(user.username) : user.username;
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

  const ranking = Array.from(agg.values())
    .filter((u) => u.totalRp > 0)
    .sort((a, b) => b.totalRp - a.totalRp || a.entries - b.entries);

  return { ranking, tournamentsCounted, tournamentsSkipped };
}

/** シーズンの RP ランキングを集計して返す（DB から取得 → 集計）。 */
export async function computeSeasonRanking(prisma: PrismaClient): Promise<SeasonRankingResult & { tournaments: SeasonTournamentRow[] }> {
  const tournaments = await fetchSeasonTournaments(prisma);
  return { ...aggregateRanking(tournaments), tournaments };
}
