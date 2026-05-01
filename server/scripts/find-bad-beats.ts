/// <reference types="node" />
/**
 * 過去のハンド履歴からバッドビートを検索するスクリプト
 *
 * 実行: cd server && npx tsx scripts/find-bad-beats.ts [--prod] [--limit 1000]
 */
import { PrismaClient } from '@prisma/client';
import { evaluatePLOHand } from '../../packages/shared/src/handEvaluator';
import type { Card, Rank, Suit } from '../../packages/shared/src/types';

const isProd = process.argv.includes('--prod');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(process.argv[limitIdx + 1]) : 10000;

if (isProd) {
  const url = process.env.DATABASE_PROD_PUBLIC_URL;
  if (!url) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('本番DBに接続\n');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

function parseCard(s: string): Card {
  return { rank: s[0] as Rank, suit: s[1] as Suit };
}

interface BadBeatResult {
  handId: string;
  createdAt: Date;
  blinds: string;
  potSize: number;
  communityCards: string[];
  loser: { username: string; userId: string | null; holeCards: string[]; handName: string; handRank: number; profit: number };
  winner: { username: string; userId: string | null; holeCards: string[]; handName: string; handRank: number; profit: number };
  badBeatTypes: string[];
}

async function main() {
  console.log(`最大 ${limit} ハンドを検索中...\n`);

  // ショーダウンまで行ったハンド = communityCards が5枚あるもの
  const hands = await prisma.handHistory.findMany({
    include: { players: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const badBeats: BadBeatResult[] = [];

  for (const hand of hands) {
    if (hand.communityCards.length !== 5) continue;

    const community = hand.communityCards.map(parseCard);
    const winnerIds = new Set(hand.winners);

    // 各プレイヤーのハンドランクを評価
    const playerEvals: { username: string; userId: string | null; holeCards: string[]; handRank: number; handName: string; profit: number; isWinner: boolean; folded: boolean }[] = [];

    for (const p of hand.players) {
      if (p.holeCards.length !== 4 && p.holeCards.length !== 5) continue;

      // フォールドしたか判定: actionsからフォールドを探す
      const actions = hand.actions as any[];
      const folded = Array.isArray(actions) && actions.some(
        (a: any) => (a.odId === p.userId || a.seatIndex === p.seatPosition) && a.action === 'fold'
      );
      if (folded) continue;

      try {
        const holeCards = p.holeCards.map(parseCard);
        const result = evaluatePLOHand(holeCards, community);
        playerEvals.push({
          username: p.username || p.userId?.slice(-8) || '???',
          userId: p.userId,
          holeCards: p.holeCards,
          handRank: result.rank,
          handName: result.name,
          profit: p.profit,
          isWinner: p.userId ? winnerIds.has(p.userId) : false,
          folded: false,
        });
      } catch {
        // 評価失敗は無視
      }
    }

    if (playerEvals.length < 2) continue;

    const winners = playerEvals.filter(p => p.isWinner);
    const losers = playerEvals.filter(p => !p.isWinner);
    if (winners.length === 0 || losers.length === 0) continue;

    const winnerHandRanks = winners.map(w => w.handRank);

    for (const loser of losers) {
      const types: string[] = [];

      if (loser.handRank === 9) types.push('bad_beat_straight_flush');
      if (loser.handRank === 8) types.push('bad_beat_quads');
      if (loser.handRank >= 7) types.push('bad_beat_fullhouse');
      if ((loser.handRank === 4 || loser.handRank === 7) &&
          winnerHandRanks.some(r => r === 4 || r === 7 || r === 8)) {
        types.push('bad_beat_set_over_set');
      }

      if (types.length > 0) {
        badBeats.push({
          handId: hand.id,
          createdAt: hand.createdAt,
          blinds: hand.blinds,
          potSize: hand.potSize,
          communityCards: hand.communityCards,
          loser: {
            username: loser.username,
            userId: loser.userId,
            holeCards: loser.holeCards,
            handName: loser.handName,
            handRank: loser.handRank,
            profit: loser.profit,
          },
          winner: {
            username: winners[0].username,
            userId: winners[0].userId,
            holeCards: winners[0].holeCards,
            handName: winners[0].handName,
            handRank: winners[0].handRank,
            profit: winners[0].profit,
          },
          badBeatTypes: types,
        });
      }
    }
  }

  // 結果表示
  console.log(`=== バッドビート検索結果: ${badBeats.length} 件 ===\n`);

  // サマリー
  const typeCounts: Record<string, number> = {};
  for (const bb of badBeats) {
    for (const t of bb.badBeatTypes) {
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
  }
  console.log('--- サマリー ---');
  const labels: Record<string, string> = {
    bad_beat_fullhouse: 'フルハウス以上で負け',
    bad_beat_quads: 'フォーカードで負け',
    bad_beat_set_over_set: 'セットオーバーセット',
    bad_beat_straight_flush: 'ストレートフラッシュで負け',
  };
  for (const [type, count] of Object.entries(typeCounts)) {
    console.log(`  ${labels[type] || type}: ${count} 件`);
  }

  // ユーザー別集計
  const userBBCount: Record<string, { username: string; count: number }> = {};
  for (const bb of badBeats) {
    const key = bb.loser.userId || bb.loser.username;
    if (!userBBCount[key]) {
      userBBCount[key] = { username: bb.loser.username, count: 0 };
    }
    userBBCount[key].count++;
  }
  console.log('\n--- ユーザー別バッドビート回数 ---');
  const sortedUsers = Object.values(userBBCount).sort((a, b) => b.count - a.count);
  for (const u of sortedUsers) {
    console.log(`  ${u.username.padEnd(20)} ${u.count} 回`);
  }

  // 詳細
  console.log('\n--- 詳細 ---');
  for (const bb of badBeats) {
    console.log(`\n[${bb.createdAt.toISOString().slice(0, 19)}] Hand: ${bb.handId}`);
    console.log(`  Blinds: ${bb.blinds} | Pot: ${bb.potSize} | Board: ${bb.communityCards.join(' ')}`);
    console.log(`  敗者: ${bb.loser.username} [${bb.loser.holeCards.join(' ')}] → ${bb.loser.handName} (rank ${bb.loser.handRank}) | ${bb.loser.profit}`);
    console.log(`  勝者: ${bb.winner.username} [${bb.winner.holeCards.join(' ')}] → ${bb.winner.handName} (rank ${bb.winner.handRank}) | +${bb.winner.profit}`);
    console.log(`  種類: ${bb.badBeatTypes.map(t => labels[t] || t).join(', ')}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
