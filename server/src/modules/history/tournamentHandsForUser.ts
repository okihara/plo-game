import type { Prisma, PrismaClient } from '@prisma/client';
import { maskName } from '../../shared/utils.js';

const playersInclude = {
  select: {
    userId: true,
    username: true,
    seatPosition: true,
    holeCards: true,
    finalHand: true,
    startChips: true,
    profit: true,
    user: {
      select: {
        username: true,
        displayName: true,
        avatarUrl: true,
        useTwitterAvatar: true,
        nameMasked: true,
      },
    },
  },
} as const;

const handHistoryInclude = { players: playersInclude } as const;

export type HandHistoryWithTournamentPlayers = Prisma.HandHistoryGetPayload<{
  include: typeof handHistoryInclude;
}>;

export type TournamentHandExportPlayer = {
  userId: string | null;
  username: string;
  avatarUrl: string | null;
  seatPosition: number;
  holeCards: string[];
  finalHand: string | null;
  startChips: number;
  profit: number;
  isCurrentUser: boolean;
};

export type TournamentHandExport = {
  id: string;
  handNumber: number;
  blinds: string;
  communityCards: string[];
  potSize: number;
  rakeAmount: number;
  winners: string[];
  actions: unknown;
  dealerPosition: number;
  createdAt: Date;
  players: TournamentHandExportPlayer[];
};

export function formatTournamentHandsForUser(
  hands: HandHistoryWithTournamentPlayers[],
  viewerUserId: string
): TournamentHandExport[] {
  return hands.map(hand => ({
    id: hand.id,
    handNumber: hand.handNumber,
    blinds: hand.blinds,
    communityCards: hand.communityCards,
    potSize: hand.potSize,
    rakeAmount: hand.rakeAmount,
    winners: hand.winners,
    actions: hand.actions,
    dealerPosition: hand.dealerPosition,
    createdAt: hand.createdAt,
    players: hand.players.map(p => {
      const rawName = p.username || p.user?.username || `Seat ${p.seatPosition + 1}`;
      return {
        userId: p.userId,
        username: p.user?.displayName
          ? p.user.displayName
          : p.userId !== viewerUserId && p.user?.nameMasked
            ? maskName(rawName)
            : rawName,
        avatarUrl: p.user?.avatarUrl ?? null,
        seatPosition: p.seatPosition,
        holeCards: p.holeCards,
        finalHand: p.finalHand,
        startChips: p.startChips,
        profit: p.profit,
        isCurrentUser: p.userId === viewerUserId,
      };
    }),
  }));
}

export async function fetchTournamentHandsForUser(
  prisma: PrismaClient,
  tournamentId: string,
  viewerUserId: string
): Promise<TournamentHandExport[]> {
  const hands = await prisma.handHistory.findMany({
    where: {
      tournamentId,
      players: { some: { userId: viewerUserId } },
    },
    orderBy: { createdAt: 'asc' },
    include: handHistoryInclude,
  });
  return formatTournamentHandsForUser(hands, viewerUserId);
}
