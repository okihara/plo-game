/// <reference types="node" />
/**
 * 結果ツイート用のトーナメントデータを JSON で出力する。
 *
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod
 *   cd server && npx tsx scripts/tournament-tweet-data.ts --prod --tournament <id>
 *
 * --tournament を省略すると「最新の COMPLETED トナメ」を対象にする。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { maskName } from '../src/shared/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const tIdx = process.argv.indexOf('--tournament');
const tournamentIdArg = tIdx >= 0 ? process.argv[tIdx + 1] : undefined;
const handsIdx = process.argv.indexOf('--hands');
const handsLimit = handsIdx >= 0 ? Number(process.argv[handsIdx + 1]) : 30;

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

function resolveDisplay(u: { displayName: string | null; username: string; nameMasked: boolean }) {
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

async function main() {
  const tournament = tournamentIdArg
    ? await prisma.tournament.findUnique({ where: { id: tournamentIdArg } })
    : await prisma.tournament.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      });

  if (!tournament) {
    console.error('対象のトナメが見つかりません');
    process.exit(1);
  }
  console.error(`対象トナメ: ${tournament.name} (${tournament.id}) status=${tournament.status}`);

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

  const topResults = results.slice(0, 5).map((r) => ({
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

  const output = {
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

  console.log(JSON.stringify(output, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
