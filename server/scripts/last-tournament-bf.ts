/// <reference types="node" />
/**
 * 直近のトーナメントのラストハンド時点における各プレイヤーの BF (Bubble Factor) を出す。
 *
 * 実行: cd server && npx tsx scripts/last-tournament-bf.ts
 *  （--prod を付けると本番、デフォルトはローカル DB）
 */
import { PrismaClient } from '@prisma/client';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { computeBubbleFactors, computeICM } from '../../packages/shared/src/icm.js';
import { PrizeCalculator } from '../src/modules/tournament/PrizeCalculator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined
);

async function main() {
  const tournament = await prisma.tournament.findFirst({
    where: { startedAt: { not: null } },
    orderBy: { startedAt: 'desc' },
    include: {
      registrations: true,
    },
  });

  if (!tournament) {
    console.log('トーナメントが見つかりません');
    return;
  }

  console.log(`Tournament: ${tournament.name} (${tournament.id})`);
  console.log(`  status: ${tournament.status}`);
  console.log(`  startedAt: ${tournament.startedAt?.toISOString()}`);
  console.log(`  prizePool: ${tournament.prizePool}`);

  const handsArg = process.argv.find(a => a.startsWith('--hands='));
  const limit = handsArg ? parseInt(handsArg.split('=')[1], 10) : 10;

  const recentHands = await prisma.handHistory.findMany({
    where: { tournamentId: tournament.id },
    orderBy: [{ createdAt: 'desc' }],
    take: limit,
    include: {
      players: true,
    },
  });

  if (recentHands.length === 0) {
    console.log('このトーナメントのハンド履歴がありません');
    return;
  }

  // リエントリー込みのエントリー数
  const totalEntries = tournament.registrations.reduce(
    (sum, r) => sum + 1 + r.reentryCount,
    0
  );
  const payoutPercentage = (tournament.payoutPercentage as number[] | null) ?? undefined;
  const prizes = PrizeCalculator.calculate(
    totalEntries,
    tournament.prizePool,
    payoutPercentage && payoutPercentage.length ? payoutPercentage : undefined
  );
  const payouts = prizes.map(p => p.amount);

  console.log(`\nTotal entries (incl. reentry): ${totalEntries}`);
  console.log(`Payouts: ${prizes.map(p => `${p.position}:${p.amount}`).join(', ')}`);

  // 古い順に並べ直して、各ハンド全プレイヤーの BF を列挙
  const handsAsc = recentHands.slice().reverse();
  for (const hand of handsAsc) {
    const players = hand.players.slice().sort((a, b) => a.seatPosition - b.seatPosition);
    const stacks = players.map(p => p.startChips);
    const icmNow = computeICM(stacks, payouts);
    const bfs = computeBubbleFactors(stacks, payouts);

    console.log(`\n#${hand.handNumber}  blinds=${hand.blinds}  seats=${players.length}`);
    console.log(`  Name         | Stack  | $EV      | BF`);
    console.log(`  -------------+--------+----------+--------`);
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const bf = bfs[i];
      const bfStr = Number.isFinite(bf) ? bf.toFixed(4) : 'NaN';
      console.log(
        `  ${p.username.padEnd(12)} | ${String(p.startChips).padStart(6)} | ${icmNow[i].toFixed(2).padStart(8)} | ${bfStr}`
      );
    }
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
