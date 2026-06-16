/**
 * 告知ツイート用のデータ集計。
 *
 * - 「直近で完了したトナメ」のサマリ（昨夜の優勝者・エントリー数）
 *   → ツイート本文に「昨夜の結果」行として織り込む
 * - 「今日 (JST) 開催予定のトナメ」基本情報
 *   → ANNOUNCE ドラフトと 1:1 で結ぶ対象トナメ
 *
 * scripts/tournament-announce-data.ts はこの fetchPreviousResult を呼ぶ
 * 形に DRY 化されている。
 */
import type { PrismaClient } from '@prisma/client';
import { maskName } from '../../../shared/utils.js';

const STALE_HOURS = 48;

export interface PreviousResultSummary {
  tournament: {
    id: string;
    name: string;
    completedAt: string;
    hoursAgo: number;
    stale: boolean;
    totalEntries: number;
    uniqueRegistrations: number;
  };
  winner: { displayName: string } | null;
}

function resolveDisplay(u: { displayName: string | null; username: string; nameMasked: boolean }) {
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

/**
 * 直近で完了したトナメのサマリを返す。
 * `stale=true` または `null` のときは呼び出し側で「昨夜の結果」行を省略する。
 */
export async function fetchPreviousResult(
  prisma: PrismaClient,
): Promise<PreviousResultSummary | null> {
  const tournament = await prisma.tournament.findFirst({
    where: { status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
  });
  if (!tournament || !tournament.completedAt) return null;

  const [registrations, winnerResult] = await Promise.all([
    prisma.tournamentRegistration.findMany({
      where: { tournamentId: tournament.id },
      select: { reentryCount: true },
    }),
    prisma.tournamentResult.findFirst({
      where: { tournamentId: tournament.id, position: 1 },
      include: {
        user: { select: { username: true, displayName: true, nameMasked: true } },
      },
    }),
  ]);

  const totalEntries =
    registrations.length + registrations.reduce((s, r) => s + r.reentryCount, 0);
  const hoursAgo = (Date.now() - tournament.completedAt.getTime()) / 3_600_000;

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      completedAt: tournament.completedAt.toISOString(),
      hoursAgo: Math.round(hoursAgo * 10) / 10,
      stale: hoursAgo > STALE_HOURS,
      totalEntries,
      uniqueRegistrations: registrations.length,
    },
    winner: winnerResult ? { displayName: resolveDisplay(winnerResult.user) } : null,
  };
}

/**
 * scheduledStartTime が今後 24 時間以内に始まる WAITING のトナメを返す。
 * tickUpcomingTournaments の検知対象。
 */
export async function fetchUpcomingTournaments(prisma: PrismaClient, limit = 5) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return prisma.tournament.findMany({
    where: {
      status: 'WAITING',
      scheduledStartTime: { gte: now, lt: tomorrow },
      tweetDrafts: { none: { kind: 'ANNOUNCE' } },
    },
    orderBy: { scheduledStartTime: 'asc' },
    take: limit,
    select: {
      id: true,
      name: true,
      scheduledStartTime: true,
      buyIn: true,
      maxPlayers: true,
    },
  });
}

export interface AnnounceContextTournament {
  id: string;
  name: string;
  scheduledStartTime: string;
  buyIn: number;
  maxPlayers: number;
  /** 'plo' / 'plo5' などのゲーム種目（プロンプトで触れる） */
  gameVariant: string;
}

export interface AnnounceContext {
  today: AnnounceContextTournament;
  previousResult: PreviousResultSummary | null;
}

/** 単一トナメの ANNOUNCE 生成に必要なデータをひとまとめにする */
export async function fetchAnnounceContext(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<AnnounceContext | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      name: true,
      scheduledStartTime: true,
      buyIn: true,
      maxPlayers: true,
      gameVariant: true,
    },
  });
  if (!tournament || !tournament.scheduledStartTime) return null;
  const previousResult = await fetchPreviousResult(prisma);
  return {
    today: {
      id: tournament.id,
      name: tournament.name,
      scheduledStartTime: tournament.scheduledStartTime.toISOString(),
      buyIn: tournament.buyIn,
      maxPlayers: tournament.maxPlayers,
      gameVariant: tournament.gameVariant,
    },
    previousResult,
  };
}
