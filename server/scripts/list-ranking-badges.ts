/// <reference types="node" />
/**
 * デイリー/ウィークリーランキングバッジの保持者一覧を表示するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/list-ranking-badges.ts          # ローカルDB
 *   cd server && npx tsx scripts/list-ranking-badges.ts --prod   # 本番DB
 */
import { PrismaClient } from '@prisma/client';

const isProd = process.argv.includes('--prod');

if (isProd) {
  const url = process.env.DATABASE_PROD_PUBLIC_URL;
  if (!url) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します\n');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

async function main() {
  // デイリー & ウィークリーバッジをユーザー情報付きで取得
  const badges = await prisma.badge.findMany({
    where: { type: { in: ['daily_rank_1', 'weekly_rank_1'] } },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
    },
    orderBy: { awardedAt: 'desc' },
  });

  const dailyBadges = badges.filter(b => b.type === 'daily_rank_1');
  const weeklyBadges = badges.filter(b => b.type === 'weekly_rank_1');

  // --- デイリーバッジ ---
  console.log('=== デイリーランキング1位バッジ ===');
  if (dailyBadges.length === 0) {
    console.log('  (なし)');
  } else {
    // ユーザーごとに集計
    const dailyByUser = new Map<string, { name: string; count: number; dates: string[] }>();
    for (const b of dailyBadges) {
      const name = b.user.displayName || b.user.username;
      const entry = dailyByUser.get(b.userId) || { name, count: 0, dates: [] };
      entry.count++;
      const jst = new Date(b.awardedAt.getTime() + 9 * 60 * 60 * 1000);
      entry.dates.push(jst.toISOString().slice(0, 10));
      dailyByUser.set(b.userId, entry);
    }

    console.log(`  合計: ${dailyBadges.length}件 (${dailyByUser.size}人)`);
    console.log('');
    for (const [userId, info] of dailyByUser) {
      console.log(`  ${info.name} (${userId}): ${info.count}回`);
      for (const d of info.dates) {
        console.log(`    - ${d}`);
      }
    }
  }

  console.log('');

  // --- ウィークリーバッジ ---
  console.log('=== ウィークリーランキング1位バッジ ===');
  if (weeklyBadges.length === 0) {
    console.log('  (なし)');
  } else {
    const weeklyByUser = new Map<string, { name: string; count: number; dates: string[] }>();
    for (const b of weeklyBadges) {
      const name = b.user.displayName || b.user.username;
      const entry = weeklyByUser.get(b.userId) || { name, count: 0, dates: [] };
      entry.count++;
      const jst = new Date(b.awardedAt.getTime() + 9 * 60 * 60 * 1000);
      entry.dates.push(jst.toISOString().slice(0, 10));
      weeklyByUser.set(b.userId, entry);
    }

    console.log(`  合計: ${weeklyBadges.length}件 (${weeklyByUser.size}人)`);
    console.log('');
    for (const [userId, info] of weeklyByUser) {
      console.log(`  ${info.name} (${userId}): ${info.count}回`);
      for (const d of info.dates) {
        console.log(`    - ${d}`);
      }
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
