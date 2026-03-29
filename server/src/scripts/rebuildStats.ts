/**
 * トーナメントのハンド履歴を削除し、PlayerStatsCacheをキャッシュゲームのみで再構築するスクリプト
 *
 * 使い方:
 *   DATABASE_URL="postgresql://..." npx tsx src/scripts/rebuildStats.ts [--rebuild-only]
 *
 *   --rebuild-only: トーナメント削除・キャッシュクリアをスキップし、再集計+書き込みのみ実行
 */

import { PrismaClient } from '@prisma/client';
import { computeIncrementForPlayer, emptyIncrement, type StatsIncrement } from '../modules/stats/statsComputation.js';

const prisma = new PrismaClient({ log: ['error'] });

const BATCH_SIZE = 500;

interface StoredAction {
  seatIndex: number;
  odId: string;
  action: string;
  amount: number;
  street?: string;
}

async function main() {
  const rebuildOnly = process.argv.includes('--rebuild-only');

  if (!rebuildOnly) {
    // 1. トーナメントのハンド履歴を削除 (blinds <> '1/3')
    const tournamentHands = await prisma.handHistory.findMany({
      where: { NOT: { blinds: '1/3' } },
      select: { id: true },
    });
    const tournamentIds = tournamentHands.map(h => h.id);

    if (tournamentIds.length > 0) {
      // 先にプレイヤーレコードを削除（FK制約）
      const deletedPlayers = await prisma.handHistoryPlayer.deleteMany({
        where: { handHistoryId: { in: tournamentIds } },
      });
      const deletedHands = await prisma.handHistory.deleteMany({
        where: { id: { in: tournamentIds } },
      });
      console.log(`Deleted ${deletedHands.count} tournament hands (${deletedPlayers.count} player records)`);
    } else {
      console.log('No tournament hands found');
    }

    // 2. PlayerStatsCacheを全削除
    const deletedStats = await prisma.playerStatsCache.deleteMany();
    console.log(`Cleared ${deletedStats.count} PlayerStatsCache rows`);
  } else {
    console.log('--rebuild-only: skipping delete steps');
  }

  // 3. キャッシュゲームのハンドから再集計
  const totalHands = await prisma.handHistory.count();
  console.log(`Rebuilding stats from ${totalHands} cash game hands...`);

  // ユーザーごとのスタッツ増分を累積
  const userStats = new Map<string, StatsIncrement>();

  let cursor: string | undefined;
  let processed = 0;

  while (true) {
    const hands = await prisma.handHistory.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: { players: true },
    });

    if (hands.length === 0) break;

    for (const hand of hands) {
      const actions = (hand.actions as StoredAction[]) ?? [];
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
          userStats.set(userId, { ...inc });
        }
      }
    }

    cursor = hands[hands.length - 1].id;
    processed += hands.length;
    if (processed % 10000 === 0 || hands.length < BATCH_SIZE) {
      console.log(`  ${processed} / ${totalHands} hands processed (${userStats.size} users)`);
    }
  }

  // 4. 一括保存
  console.log(`Writing stats for ${userStats.size} users...`);
  const writes: Promise<unknown>[] = [];
  for (const [userId, inc] of userStats) {
    writes.push(
      prisma.playerStatsCache.upsert({
        where: { userId },
        create: { userId, ...inc },
        update: { ...inc },
      })
    );
    // 並列書き込みを抑える
    if (writes.length >= 50) {
      await Promise.all(writes);
      writes.length = 0;
    }
  }
  if (writes.length > 0) await Promise.all(writes);

  console.log('Done!');
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

main()
  .catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
