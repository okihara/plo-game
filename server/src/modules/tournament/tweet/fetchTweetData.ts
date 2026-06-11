/**
 * 結果ツイート用のトーナメントデータを DB から取得する。
 * PrismaClient は呼び出し側から注入する（本番/ローカルの切り替えはスクリプト側の責務）。
 */
import type { PrismaClient } from '@prisma/client';
import { maskName } from '../../../shared/utils.js';
import type { TournamentTweetData } from './types.js';

function resolveDisplay(u: { displayName: string | null; username: string; nameMasked: boolean }) {
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

export interface FetchTweetDataOptions {
  /** 省略時は最新の COMPLETED トナメを対象にする */
  tournamentId?: string;
  /** 末尾から取得するハンド数（デフォルト 50） */
  handsLimit?: number;
}

/**
 * 結果ツイートに必要なトナメ情報・順位・直近ハンドをまとめて取得する。
 * 対象トナメが見つからない場合は null を返す。
 */
export async function fetchTournamentTweetData(
  prisma: PrismaClient,
  options: FetchTweetDataOptions = {},
): Promise<TournamentTweetData | null> {
  const { tournamentId, handsLimit = 50 } = options;

  const tournament = tournamentId
    ? await prisma.tournament.findUnique({ where: { id: tournamentId } })
    : await prisma.tournament.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      });

  if (!tournament) return null;

  const [registrations, results, lastHands] = await Promise.all([
    prisma.tournamentRegistration.findMany({
      where: { tournamentId: tournament.id },
      select: { reentryCount: true },
    }),
    prisma.tournamentResult.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { position: 'asc' },
      include: {
        user: { select: { id: true, username: true, displayName: true, nameMasked: true } },
      },
    }),
    prisma.handHistory.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { createdAt: 'desc' },
      take: handsLimit,
      include: {
        players: {
          include: {
            user: { select: { id: true, username: true, displayName: true, nameMasked: true } },
          },
        },
      },
    }),
  ]);

  const totalEntries =
    registrations.length + registrations.reduce((s, r) => s + r.reentryCount, 0);

  const winner = results[0];
  const winnerUserId = winner?.userId ?? null;

  // 入賞(prize>0)の人数は回によって変わるため、余裕を持って上位を返す（消費側で必要数だけ使う）
  const topResults = results.slice(0, 30).map((r) => ({
    position: r.position,
    userId: r.userId,
    displayName: resolveDisplay(r.user),
    prize: r.prize,
    reentries: r.reentries,
  }));

  // 最後のハンドから順番に並んでいるので、古い順に戻す（読みやすさ重視）
  const handsAsc = [...lastHands].reverse();

  const handsOut = handsAsc.map((h) => ({
    handNumber: h.handNumber,
    createdAt: h.createdAt.toISOString(),
    blinds: h.blinds,
    communityCards: h.communityCards,
    potSize: h.potSize,
    winnerUserIds: h.winners,
    winnerNames: h.players
      .filter((p) => p.userId && h.winners.includes(p.userId))
      .map((p) => (p.user ? resolveDisplay(p.user) : p.username)),
    players: h.players.map((p) => ({
      userId: p.userId,
      displayName: p.user ? resolveDisplay(p.user) : p.username,
      seatPosition: p.seatPosition,
      startChips: p.startChips,
      profit: p.profit,
      holeCards: p.userId === winnerUserId ? p.holeCards : undefined,
      finalHand: p.finalHand,
      isWinnerOfTournament: p.userId === winnerUserId,
    })),
    actions: h.actions,
  }));

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      buyIn: tournament.buyIn,
      startedAt: tournament.startedAt?.toISOString() ?? null,
      completedAt: tournament.completedAt?.toISOString() ?? null,
      totalEntries,
      uniqueRegistrations: registrations.length,
      totalReentries: totalEntries - registrations.length,
    },
    winner: winner
      ? {
          userId: winner.userId,
          displayName: resolveDisplay(winner.user),
          prize: winner.prize,
          reentries: winner.reentries,
        }
      : null,
    topResults,
    lastHands: handsOut,
  };
}
