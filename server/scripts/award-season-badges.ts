/**
 * シーズンRPランキング TOP10 バッジ付与スクリプト
 *
 * CURRENT_SEASON の期間で RP ランキングを集計し、上位10人（Bot除く）に
 * 順位付きバッジ（CURRENT_SEASON.rankBadgeType）を付与する。
 * 既存があれば順位のみ更新し、TOP10 から外れたユーザーの同シーズンバッジは削除する（冪等）。
 *
 * 実行:
 *   cd server && npx tsx scripts/award-season-badges.ts            # ローカルDB
 *   cd server && npx tsx scripts/award-season-badges.ts --prod     # 本番DB (.env の DATABASE_PROD_PUBLIC_URL)
 *   cd server && npx tsx scripts/award-season-badges.ts --dry-run  # 付与せず対象だけ表示
 *
 * 前提: 事前に `npm run db:push`（本番は本番向け）で Badge.rank カラムを反映しておくこと。
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { computeSeasonRanking } from '../src/modules/season/computeSeasonRanking.js';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dry-run');

const TOP_N = 10;

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

async function main() {
  const badgeType = CURRENT_SEASON.rankBadgeType;
  console.log(`\n=== ${CURRENT_SEASON.name} RPランキング TOP${TOP_N} バッジ (${badgeType}) ===`);
  if (dryRun) console.log('(dry-run: 付与は行いません)');

  const { ranking, tournamentsCounted } = await computeSeasonRanking(prisma);
  console.log(`対象トーナメント: ${tournamentsCounted}件 / ランクイン: ${ranking.length}人`);

  const top = ranking.slice(0, TOP_N);
  if (top.length === 0) {
    console.log('対象者がいません');
    return;
  }

  const existing = await prisma.badge.findMany({
    where: { type: badgeType },
    select: { id: true, userId: true, rank: true },
  });
  const existingByUser = new Map(existing.map(b => [b.userId, b]));
  const topUserIds = new Set(top.map(u => u.userId));

  let created = 0;
  let updated = 0;
  let removed = 0;

  for (const [i, u] of top.entries()) {
    const rank = i + 1;
    const ex = existingByUser.get(u.userId);
    if (!ex) {
      console.log(`  ${rank}位: ${u.name} (${u.userId}) RP=${u.totalRp} → 新規付与`);
      if (!dryRun) await prisma.badge.create({ data: { userId: u.userId, type: badgeType, rank } });
      created++;
    } else if (ex.rank !== rank) {
      console.log(`  ${rank}位: ${u.name} (${u.userId}) RP=${u.totalRp} → 順位更新 (${ex.rank} → ${rank})`);
      if (!dryRun) await prisma.badge.update({ where: { id: ex.id }, data: { rank } });
      updated++;
    } else {
      console.log(`  ${rank}位: ${u.name} (${u.userId}) RP=${u.totalRp} → 変更なし`);
    }
  }

  // TOP10 から外れた既存バッジを削除
  for (const b of existing) {
    if (!topUserIds.has(b.userId)) {
      console.log(`  TOP${TOP_N}外: ${b.userId} → バッジ削除`);
      if (!dryRun) await prisma.badge.delete({ where: { id: b.id } });
      removed++;
    }
  }

  console.log(`\n✅ 新規${created} / 更新${updated} / 削除${removed}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
