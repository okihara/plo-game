/// <reference types="node" />
/**
 * ハンド履歴・スタッツが見れないユーザーの診断スクリプト
 * 対象ユーザーのハンド数・キャッシュ状態・主要クエリの所要時間を計測する
 *
 * 実行:
 *   cd server && npx tsx scripts/diagnose-heavy-user.ts <名前の一部> --prod
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const nameQuery = positional[0] || 'ゆたちん';

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient(
  isProd
    ? { datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } }
    : undefined,
);

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`  [${label}] ${Date.now() - start}ms`);
    return result;
  } catch (e) {
    console.log(`  [${label}] ERROR after ${Date.now() - start}ms:`, (e as Error).message);
    return null;
  }
}

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: nameQuery, mode: 'insensitive' } },
        { displayName: { contains: nameQuery, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, displayName: true, createdAt: true },
  });

  if (users.length === 0) {
    console.log(`「${nameQuery}」に一致するユーザーが見つかりません`);
    return;
  }

  for (const user of users) {
    console.log(`\n=== ${user.displayName || user.username} (id=${user.id}) ===`);

    const handCount = await timed('HandHistoryPlayer count', () =>
      prisma.handHistoryPlayer.count({ where: { userId: user.id } }));
    console.log(`  総ハンド数: ${handCount}`);

    const cashCount = await timed('cash count (tournamentId null)', () =>
      prisma.handHistoryPlayer.count({
        where: { userId: user.id, handHistory: { tournamentId: null } },
      }));
    console.log(`  キャッシュゲームハンド数: ${cashCount}`);

    const statsCache = await timed('PlayerStatsCache', () =>
      prisma.playerStatsCache.findUnique({ where: { userId: user.id } }));
    console.log(`  PlayerStatsCache: ${statsCache ? `handsPlayed=${statsCache.handsPlayed}, updatedAt=${(statsCache as any).updatedAt ?? 'n/a'}` : 'なし'}`);

    const tourneyCache = await timed('TournamentStatsCache', () =>
      prisma.tournamentStatsCache.findUnique({ where: { userId: user.id } }));
    console.log(`  TournamentStatsCache: ${tourneyCache ? `handsPlayed=${tourneyCache.handsPlayed}` : 'なし'}`);

    // /api/history 一覧クエリの再現（1ページ目）
    await timed('history list query (take 20)', () =>
      prisma.handHistoryPlayer.findMany({
        where: { userId: user.id, handHistory: {} },
        orderBy: { handHistory: { createdAt: 'desc' } },
        take: 20,
        include: {
          handHistory: {
            select: {
              id: true, handNumber: true, blinds: true, communityCards: true,
              communityCards2: true, potSize: true, winners: true,
              dealerPosition: true, createdAt: true,
              players: {
                select: {
                  userId: true, username: true, seatPosition: true, holeCards: true,
                  finalHand: true, startChips: true, profit: true,
                  user: { select: { displayName: true, avatarUrl: true, useTwitterAvatar: true, nameMasked: true } },
                },
              },
            },
          },
        },
      }));

    // /api/history の total count（cash フィルタ）
    await timed('history count (cash filter)', () =>
      prisma.handHistoryPlayer.count({
        where: { userId: user.id, handHistory: { tournamentId: null } },
      }));

    // /api/stats/:userId/profit-history の再現
    const rows = await timed('profit-history query (all rows)', () =>
      prisma.handHistoryPlayer.findMany({
        where: { userId: user.id, handHistory: { tournamentId: null } },
        orderBy: { handHistory: { createdAt: 'asc' } },
        select: { profit: true, finalHand: true, allInEVProfit: true },
      }));
    if (rows) {
      const jsonSize = JSON.stringify(rows).length;
      console.log(`  profit-history rows=${rows.length}, おおよそのJSONサイズ=${(jsonSize / 1024 / 1024).toFixed(2)}MB`);
    }

    // /api/history/tournaments の再現（distinct tournamentId）
    await timed('history tournaments distinct query', () =>
      prisma.handHistory.findMany({
        where: { NOT: { tournamentId: null }, players: { some: { userId: user.id } } },
        distinct: ['tournamentId'],
        select: { tournamentId: true },
        orderBy: { createdAt: 'desc' },
      }));
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
