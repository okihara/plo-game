/// <reference types="node" />
/**
 * TournamentStatsCache を HandHistory（tournamentId IS NOT NULL）から再構築するスクリプト。
 *
 * 既存の TournamentStatsCache を全削除してから、トーナメントハンドを走査して
 * 各ユーザーの累積スタッツを再計算・upsert する。
 *
 *   cd server && npx tsx scripts/rebuild-tournament-stats.ts           # ローカルDB
 *   cd server && npx tsx scripts/rebuild-tournament-stats.ts --prod    # 本番DB
 *   cd server && npx tsx scripts/rebuild-tournament-stats.ts --prod --dry-run  # 集計のみ（書き込みなし）
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import {
  computeIncrementForPlayer,
  emptyIncrement,
  type StatsIncrement,
} from '../src/modules/stats/statsComputation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const isDryRun = process.argv.includes('--dry-run');

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
  log: ['error'],
});

const BATCH_SIZE = 500;

interface StoredAction {
  seatIndex: number;
  odId: string;
  action: string;
  amount: number;
  street?: string;
}

function addIncrement(target: StatsIncrement, inc: StatsIncrement) {
  target.handsPlayed += inc.handsPlayed;
  target.winCount += inc.winCount;
  target.totalProfit += inc.totalProfit;
  target.totalAllInEVProfit += inc.totalAllInEVProfit;
  target.detailedHands += inc.detailedHands;
  target.vpipCount += inc.vpipCount;
  target.pfrCount += inc.pfrCount;
  target.threeBetCount += inc.threeBetCount;
  target.threeBetOpportunity += inc.threeBetOpportunity;
  target.foldTo3BetCount += inc.foldTo3BetCount;
  target.faced3BetCount += inc.faced3BetCount;
  target.fourBetCount += inc.fourBetCount;
  target.fourBetOpportunity += inc.fourBetOpportunity;
  target.aggressiveActions += inc.aggressiveActions;
  target.totalPostflopActions += inc.totalPostflopActions;
  target.cbetCount += inc.cbetCount;
  target.cbetOpportunity += inc.cbetOpportunity;
  target.foldToCbetCount += inc.foldToCbetCount;
  target.facedCbetCount += inc.facedCbetCount;
  target.sawFlopCount += inc.sawFlopCount;
  target.wtsdCount += inc.wtsdCount;
  target.wsdCount += inc.wsdCount;
}

async function main() {
  const totalHands = await prisma.handHistory.count({ where: { tournamentId: { not: null } } });
  console.log(`トーナメントハンド件数: ${totalHands}`);

  if (totalHands === 0) {
    console.log('再計算対象のハンドがありません');
    return;
  }

  // ユーザーごとのスタッツを累積
  const userStats = new Map<string, StatsIncrement>();

  let cursor: string | undefined;
  let processed = 0;

  while (true) {
    const hands = await prisma.handHistory.findMany({
      where: { tournamentId: { not: null } },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: { players: true },
    });

    if (hands.length === 0) break;

    for (const hand of hands) {
      const actions = (hand.actions as unknown as StoredAction[]) ?? [];
      const winnerOdIds = hand.winners as string[];
      const activeSeatPositions = hand.players.map(p => p.seatPosition);
      const playerInfos = hand.players.map(p => ({
        odId: p.userId ?? '',
        seatPosition: p.seatPosition,
        finalHand: p.finalHand,
      }));

      for (const hp of hand.players) {
        const userId = hp.userId;
        if (!userId) continue;

        const inc = computeIncrementForPlayer(
          userId,
          hp.seatPosition,
          hp.profit,
          actions,
          hand.dealerPosition,
          winnerOdIds,
          activeSeatPositions,
          hand.communityCards.length,
          playerInfos,
          hp.allInEVProfit,
        );

        const existing = userStats.get(userId);
        if (existing) {
          addIncrement(existing, inc);
        } else {
          const fresh = emptyIncrement();
          addIncrement(fresh, inc);
          userStats.set(userId, fresh);
        }
      }
    }

    cursor = hands[hands.length - 1].id;
    processed += hands.length;
    if (processed % 5000 === 0 || hands.length < BATCH_SIZE) {
      console.log(`  ${processed} / ${totalHands} hands processed (${userStats.size} users)`);
    }
  }

  console.log(`集計完了: ${userStats.size} ユーザー分`);

  if (isDryRun) {
    console.log('--dry-run: 書き込みスキップ');
    // 上位5名プレビュー
    const preview = [...userStats.entries()]
      .sort((a, b) => b[1].handsPlayed - a[1].handsPlayed)
      .slice(0, 5);
    for (const [uid, s] of preview) {
      console.log(`  ${uid}  hands=${s.handsPlayed} profit=${s.totalProfit}`);
    }
    return;
  }

  // 既存キャッシュをクリアしてから再計算結果を書き込む
  const deleted = await prisma.tournamentStatsCache.deleteMany();
  console.log(`既存 TournamentStatsCache ${deleted.count} 件を削除`);

  const writes: Promise<unknown>[] = [];
  let written = 0;
  for (const [userId, inc] of userStats) {
    writes.push(
      prisma.tournamentStatsCache.upsert({
        where: { userId },
        create: { userId, ...inc },
        update: { ...inc },
      })
    );
    if (writes.length >= 50) {
      await Promise.all(writes);
      written += writes.length;
      writes.length = 0;
    }
  }
  if (writes.length > 0) {
    await Promise.all(writes);
    written += writes.length;
  }
  console.log(`書き込み完了: ${written} ユーザー`);
}

main()
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
