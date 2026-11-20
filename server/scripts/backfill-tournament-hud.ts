/// <reference types="node" />
/**
 * TournamentStatsCache の HUD 列（hud<Key>N / hud<Key>D）を、トナメのハンド履歴から埋め直すスクリプト。
 * HUD 列だけを上書きし、プロフィール用の列には触らない。
 *
 * 開始時刻より前のハンドを集計して上書きするため、集計中に終わったハンドの加算は上書きで消える。
 * トナメのない時間帯に実行する。直近10分にトナメのハンドがあれば始めず、
 * 書き込み直前に開始時刻以降のハンドが見つかれば書き込まずに中断する（再実行すればよい）。
 *
 *   cd server && npx tsx scripts/backfill-tournament-hud.ts                     # ローカルDB
 *   cd server && npx tsx scripts/backfill-tournament-hud.ts --prod --dry-run    # 本番DB・集計のみ（書き込みなし）
 *   cd server && npx tsx scripts/backfill-tournament-hud.ts --prod              # 本番DB
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import type { PlayerHudStats } from '@plo/shared';
import { addHud, computeHandHud, emptyHud } from '../src/modules/stats/hudStats.js';
import { storedHandToHudInput } from '../src/modules/stats/hudLoader.js';
import { hudToCacheFields } from '../src/modules/stats/hudCacheFields.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const isDryRun = process.argv.includes('--dry-run');

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
  log: ['error'],
});

const BATCH_SIZE = 1000;

async function main() {
  console.log(`接続先: ${isProd ? '本番' : 'ローカル'}${isDryRun ? '（書き込みなし）' : ''}`);

  const startedAt = new Date();
  // Tournament.status は異常終了で RUNNING のまま残ることがあるため、実際にハンドが保存されているかで判定する
  const recent = await prisma.handHistory.count({
    where: { tournamentId: { not: null }, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } },
  });
  if (recent > 0 && !isDryRun) {
    console.error(`直近10分にトナメのハンドが ${recent} 件あるため中断します（トナメのない時間に実行する）`);
    process.exit(1);
  }

  const huds = new Map<string, PlayerHudStats>();
  let cursor: string | undefined;
  let processed = 0;
  for (;;) {
    const hands = await prisma.handHistory.findMany({
      where: { tournamentId: { not: null }, createdAt: { lt: startedAt } },
      take: BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        actions: true,
        dealerPosition: true,
        blinds: true,
        players: { select: { seatPosition: true, userId: true } },
      },
    });
    if (hands.length === 0) break;

    for (const hand of hands) {
      const userIds = new Set(hand.players.flatMap(p => (p.userId ? [p.userId] : [])));
      for (const [odId, hud] of computeHandHud(storedHandToHudInput(hand))) {
        if (userIds.has(odId)) huds.set(odId, addHud(huds.get(odId) ?? emptyHud(), hud));
      }
    }
    processed += hands.length;
    cursor = hands[hands.length - 1].id;
    console.log(`  ${processed} ハンド集計`);
  }
  console.log(`集計完了: ${processed} ハンド, ${huds.size} ユーザー`);

  // 既存のプロフィール用ハンド数と突き合わせ、ずれが大きい人を出す（参考）
  const rows = await prisma.tournamentStatsCache.findMany({ select: { userId: true, handsPlayed: true } });
  const cached = new Map(rows.map(r => [r.userId, r.handsPlayed]));
  const missing = [...huds.keys()].filter(id => !cached.has(id));
  const mismatched = [...huds].filter(([id, h]) => cached.has(id) && cached.get(id) !== h.hands);
  console.log(`キャッシュ行がない人: ${missing.length}（書き込み対象外）`);
  console.log(`handsPlayed と HUD のハンド数が違う人: ${mismatched.length}`);
  for (const [id, h] of mismatched.slice(0, 10)) console.log(`  ${id}: handsPlayed=${cached.get(id)} hud=${h.hands}`);

  if (isDryRun) return;

  const during = await prisma.handHistory.count({ where: { tournamentId: { not: null }, createdAt: { gte: startedAt } } });
  if (during > 0) {
    console.error(`集計中にトナメのハンドが ${during} 件増えたため、書き込まずに中断します`);
    process.exit(1);
  }

  // 履歴にハンドがない行も含め、全行の HUD 列を集計結果（なければ 0）で上書きする
  let written = 0;
  for (const { userId } of rows) {
    await prisma.tournamentStatsCache.update({
      where: { userId },
      data: hudToCacheFields(huds.get(userId) ?? emptyHud()),
    });
    written++;
  }
  console.log(`書き込み完了: ${written} 行`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
