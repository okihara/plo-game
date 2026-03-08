/// <reference types="node" />
/**
 * 過去のハンド履歴からバッドビートを検出してバッジを付与するスクリプト
 *
 * 実行: cd server && npx tsx scripts/award-bad-beat-badges.ts [--prod] [--limit 10000] [--dry-run]
 */
import { PrismaClient } from '@prisma/client';
import { evaluatePLOHand } from '../../packages/shared/src/handEvaluator';
import type { Card, Rank, Suit } from '../../packages/shared/src/types';

const isProd = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dry-run');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1]) : 10000;

if (isProd) {
  const url = process.env.DATABASE_PROD_PUBLIC_URL;
  if (!url) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('本番DBに接続');
}

if (dryRun) {
  console.log('ドライラン: バッジは付与されません');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

function parseCard(s: string): Card {
  return { rank: s[0] as Rank, suit: s[1] as Suit };
}

type BadBeatType = 'bad_beat_fullhouse' | 'bad_beat_quads' | 'bad_beat_straight_flush';

async function main() {
  console.log(`\n最大 ${limit} ハンドを検索中...\n`);

  // ボットユーザーIDを取得（provider === 'bot'）
  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true },
  });
  const botUserIds = new Set(botUsers.map(u => u.id));
  console.log(`ボットユーザー: ${botUserIds.size} 人（除外対象）\n`);

  const hands = await prisma.handHistory.findMany({
    include: { players: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // 付与するバッジを収集
  const badgeAwards: { userId: string; type: BadBeatType; handId: string; username: string }[] = [];

  for (const hand of hands) {
    if (hand.communityCards.length !== 5) continue;

    const community = hand.communityCards.map(parseCard);
    const winnerIds = new Set(hand.winners);

    const playerEvals: { userId: string | null; handRank: number; isWinner: boolean; username: string }[] = [];

    for (const p of hand.players) {
      if (p.holeCards.length !== 4) continue;

      const actions = hand.actions as any[];
      const folded = Array.isArray(actions) && actions.some(
        (a: any) => (a.odId === p.userId || a.seatIndex === p.seatPosition) && a.action === 'fold'
      );
      if (folded) continue;

      try {
        const holeCards = p.holeCards.map(parseCard);
        const result = evaluatePLOHand(holeCards, community);
        playerEvals.push({
          userId: p.userId,
          handRank: result.rank,
          isWinner: p.userId ? winnerIds.has(p.userId) : false,
          username: p.username || p.userId?.slice(-8) || '???',
        });
      } catch {
        // 評価失敗は無視
      }
    }

    if (playerEvals.length < 2) continue;

    const winners = playerEvals.filter(p => p.isWinner);
    const losers = playerEvals.filter(p => !p.isWinner);
    if (winners.length === 0 || losers.length === 0) continue;

    for (const loser of losers) {
      if (!loser.userId) continue;
      if (botUserIds.has(loser.userId)) continue; // ボットは除外

      if (loser.handRank === 9) {
        badgeAwards.push({ userId: loser.userId, type: 'bad_beat_straight_flush', handId: hand.id, username: loser.username });
      }
      if (loser.handRank === 8) {
        badgeAwards.push({ userId: loser.userId, type: 'bad_beat_quads', handId: hand.id, username: loser.username });
      }
      if (loser.handRank >= 7) {
        badgeAwards.push({ userId: loser.userId, type: 'bad_beat_fullhouse', handId: hand.id, username: loser.username });
      }
    }
  }

  // サマリー表示
  const typeCounts: Record<string, number> = {};
  for (const a of badgeAwards) {
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
  }
  console.log('--- 検出されたバッドビート ---');
  const labels: Record<string, string> = {
    bad_beat_fullhouse: 'フルハウス以上で負け',
    bad_beat_quads: 'フォーカードで負け',
    bad_beat_straight_flush: 'ストレートフラッシュで負け',
  };
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${labels[type] || type}: ${count} 件`);
  }

  // ユーザー別集計
  const userCounts: Record<string, { username: string; counts: Record<string, number> }> = {};
  for (const a of badgeAwards) {
    if (!userCounts[a.userId]) {
      userCounts[a.userId] = { username: a.username, counts: {} };
    }
    userCounts[a.userId].counts[a.type] = (userCounts[a.userId].counts[a.type] || 0) + 1;
  }
  console.log('\n--- ユーザー別 ---');
  for (const [userId, info] of Object.entries(userCounts)) {
    const details = Object.entries(info.counts).map(([t, c]) => `${labels[t] || t}: ${c}`).join(', ');
    console.log(`  ${info.username.padEnd(20)} ${details}`);
  }

  if (dryRun) {
    console.log(`\nドライラン完了。${badgeAwards.length} 件のバッジが付与対象です。`);
    return;
  }

  // 既存のバッドビートバッジを全削除してから再付与（冪等性のため）
  console.log('\n既存のバッドビートバッジを削除中...');
  const deleted = await prisma.badge.deleteMany({
    where: {
      type: { in: ['bad_beat_fullhouse', 'bad_beat_quads', 'bad_beat_straight_flush'] },
    },
  });
  console.log(`  ${deleted.count} 件削除`);

  // バッジ付与
  console.log(`\n${badgeAwards.length} 件のバッジを付与中...`);
  let created = 0;
  for (const award of badgeAwards) {
    await prisma.badge.create({
      data: {
        userId: award.userId,
        type: award.type,
      },
    });
    created++;
  }

  console.log(`\n完了! ${created} 件のバッジを付与しました。`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
