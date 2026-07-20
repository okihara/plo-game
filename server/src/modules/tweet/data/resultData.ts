/**
 * 完了済みトーナメントの結果集計（ツイート用 / 評価用）。
 *
 * 既存 scripts/tournament-tweet-data.ts と同じ出力構造を返すよう作ったので、
 * scripts 側もこの関数を呼ぶ形に DRY 化されている。
 */
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_AVATAR_URL } from '@plo/shared';
import { maskName } from '../../../shared/utils.js';

export interface ResultDataOptions {
  /** 対象トナメ ID。省略時は最新の COMPLETED を取る */
  tournamentId?: string;
  /** 何ハンドぶん lastHands に含めるか */
  handsLimit?: number;
}

export interface ResultBundle {
  tournament: {
    id: string;
    name: string;
    status: string;
    buyIn: number;
    startedAt: string | null;
    completedAt: string | null;
    totalEntries: number;
    uniqueRegistrations: number;
    totalReentries: number;
  };
  winner: {
    userId: string;
    displayName: string;
    prize: number;
    reentries: number;
  } | null;
  topResults: Array<{
    position: number;
    userId: string;
    displayName: string;
    prize: number;
    reentries: number;
    /** ゲーム内表示と同じ解決済みアイコン（URL か /images/... のパス） */
    avatarUrl: string;
  }>;
  lastHands: Array<{
    handNumber: number;
    createdAt: string;
    blinds: string;
    communityCards: unknown;
    potSize: number;
    winnerUserIds: string[];
    winnerNames: string[];
    players: Array<{
      userId: string | null;
      displayName: string;
      seatPosition: number;
      startChips: number;
      profit: number;
      holeCards: unknown;
      finalHand: unknown;
      isWinnerOfTournament: boolean;
    }>;
    actions: unknown;
  }>;
}

function resolveDisplay(u: { displayName: string | null; username: string; nameMasked: boolean }) {
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

export async function fetchResultData(
  prisma: PrismaClient,
  options: ResultDataOptions = {},
): Promise<ResultBundle | null> {
  const handsLimit = options.handsLimit ?? 50;

  const tournament = options.tournamentId
    ? await prisma.tournament.findUnique({ where: { id: options.tournamentId } })
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
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            nameMasked: true,
            avatarUrl: true,
          },
        },
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

  // インマネ（賞金が出た）人数は毎回変わるので prize > 0 で絞る。
  // 念のため上位最大 16 名までに制限（賞金が無ければ最低でも優勝者は載せる）。
  const inMoney = results.filter((r) => r.prize > 0);
  const topResults = (inMoney.length > 0 ? inMoney : results.slice(0, 1))
    .slice(0, 16)
    .map((r) => ({
      position: r.position,
      userId: r.userId,
      displayName: resolveDisplay(r.user),
      prize: r.prize,
      reentries: r.reentries,
      avatarUrl: r.user.avatarUrl || DEFAULT_AVATAR_URL,
    }));

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
