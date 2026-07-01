/**
 * シーズンRPランキング バッジ付与スクリプト
 *
 * CURRENT_SEASON の期間で RP ランキングを集計し、参加者に順位帯バッジを付与する。
 *   1位   → {prefix}_no1     2位 → {prefix}_no2     3位 → {prefix}_no3
 *   4-10位 → {prefix}_top10   11-30位 → {prefix}_top30
 *   それ以外の参加者（RP圏外含む） → {prefix}_member（参加記念）
 * 1人につき1枚に整合する（既存が別の帯なら貼り替え、参加していない既存は削除）。冪等。
 * top10/top30 のみ実順位を rank に保存（UIで右上表示）。
 *
 * 実行:
 *   cd server && npx tsx scripts/award-season-badges.ts            # ローカルDB
 *   cd server && npx tsx scripts/award-season-badges.ts --prod     # 本番DB (.env の DATABASE_PROD_PUBLIC_URL)
 *   cd server && npx tsx scripts/award-season-badges.ts --dry-run  # 付与せず対象だけ表示
 *
 * 前提: 事前に `npm run db:push`（本番は本番向け）で Badge.rank(rankPosition) を反映しておくこと。
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { computeSeasonRanking, resolveDisplayName } from '../src/modules/season/computeSeasonRanking.js';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';
import { seasonBadgeTypes, seasonBadgeTypeForRank } from '../src/modules/badges/badgeService.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const dryRun = process.argv.includes('--dry-run');

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
  const prefix = CURRENT_SEASON.badgePrefix;
  console.log(`\n=== ${CURRENT_SEASON.name} RPランキング バッジ (${prefix}_*) ===`);
  if (dryRun) console.log('(dry-run: 付与は行いません)');

  const { ranking, tournaments, tournamentsCounted } = await computeSeasonRanking(prisma);
  console.log(`対象トーナメント: ${tournamentsCounted}件 / ランクイン(RP>0): ${ranking.length}人`);

  // 順位（1始まり）と表示名
  const rankByUser = new Map<string, number>();
  ranking.forEach((u, i) => rankByUser.set(u.userId, i + 1));
  const nameByUser = new Map<string, string>(ranking.map(u => [u.userId, u.name]));

  // 参加者（Bot以外の全エントラント）を収集
  const participants = new Set<string>();
  for (const t of tournaments) {
    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      participants.add(r.userId);
      if (!nameByUser.has(r.userId)) nameByUser.set(r.userId, resolveDisplayName(r.user));
    }
  }
  console.log(`参加者(Bot除く): ${participants.size}人`);

  // 望ましい状態: userId -> { type, rank }
  const desired = new Map<string, { type: string; rank: number | null }>();
  for (const uid of participants) {
    const rank = rankByUser.get(uid) ?? null;
    desired.set(uid, { type: seasonBadgeTypeForRank(prefix, rank), rank });
  }

  // 既存のシーズンバッジ
  const types = seasonBadgeTypes(prefix);
  const existing = await prisma.badge.findMany({
    where: { type: { in: types } },
    select: { id: true, userId: true, type: true, rank: true },
  });
  const byUser = new Map<string, typeof existing>();
  for (const b of existing) {
    const arr = byUser.get(b.userId) ?? [];
    arr.push(b);
    byUser.set(b.userId, arr);
  }

  // 差分算出
  const toCreate: { userId: string; type: string; rank: number | null }[] = [];
  const toDeleteIds: string[] = [];
  for (const [uid, d] of desired) {
    const cur = byUser.get(uid) ?? [];
    let keep: (typeof existing)[number] | null = null;
    for (const b of cur) {
      if (!keep && b.type === d.type && (b.rank ?? null) === (d.rank ?? null)) keep = b;
      else toDeleteIds.push(b.id);
    }
    if (!keep) toCreate.push({ userId: uid, type: d.type, rank: d.rank });
  }
  // 参加者でない既存バッジは削除
  for (const b of existing) {
    if (!desired.has(b.userId)) toDeleteIds.push(b.id);
  }

  // 内訳表示（付与後の望ましい状態のtype別人数）
  const countByType = new Map<string, number>();
  for (const d of desired.values()) countByType.set(d.type, (countByType.get(d.type) ?? 0) + 1);
  console.log('\n-- 望ましい内訳 --');
  for (const t of types) console.log(`  ${t}: ${countByType.get(t) ?? 0}人`);

  // 表彰台のログ
  console.log('\n-- 上位 --');
  for (const u of ranking.slice(0, 10)) {
    console.log(`  ${rankByUser.get(u.userId)}位 ${u.name} (RP=${u.totalRp})`);
  }

  console.log(`\n新規付与: ${toCreate.length}件 / 削除(貼り替え含む): ${toDeleteIds.length}件`);
  if (dryRun) {
    console.log('(dry-run のため書き込みなし)');
    return;
  }

  if (toDeleteIds.length > 0) {
    await prisma.badge.deleteMany({ where: { id: { in: toDeleteIds } } });
  }
  if (toCreate.length > 0) {
    await prisma.badge.createMany({ data: toCreate });
  }
  console.log('✅ 完了');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
