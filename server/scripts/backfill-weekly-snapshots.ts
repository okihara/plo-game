/**
 * 過去の週間ランキングスナップショットを一括生成するスクリプト
 * 旧基準（JST 3:00 = UTC 18:00）で集計し、WeeklyRankingSnapshot に保存する。
 * weekStart キーは新基準（月曜 JST 0:00 = UTC 日曜 15:00）に正規化して保存。
 *
 * 実行:
 *   cd server && npx tsx scripts/backfill-weekly-snapshots.ts          # ローカルDB
 *   cd server && npx tsx scripts/backfill-weekly-snapshots.ts --prod   # 本番DB
 */
import { PrismaClient, Prisma } from '@prisma/client';

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

const OLD_JST_RESET_HOUR_UTC = 18; // 旧基準: UTC 18:00 = JST 3:00
const NEW_JST_RESET_HOUR_UTC = 15; // 新基準: UTC 15:00 = JST 0:00
const MIN_HANDS = 10;

function maskName(name: string): string {
  if (name.length <= 2) return name[0] + '*';
  const show = Math.max(2, Math.ceil(name.length * 0.3));
  return name.slice(0, show) + '*'.repeat(name.length - show);
}

/** 新基準での weekStart を求める（月曜 JST 0:00 = UTC 日曜 15:00） */
function toNewWeekStart(oldWeekStart: Date): Date {
  // 旧基準の weekStart（月曜 UTC 18:00）→ 同じ週の月曜 JST 0:00（UTC 日曜 15:00）
  // = 3時間前にずらす
  const newStart = new Date(oldWeekStart.getTime() - 3 * 60 * 60 * 1000);
  return newStart;
}

async function main() {
  // 最も古いハンド履歴の日付を取得
  const oldest = await prisma.handHistory.findFirst({
    where: { tournamentId: null },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (!oldest) {
    console.log('ハンド履歴がありません');
    return;
  }

  console.log(`最古のハンド: ${oldest.createdAt.toISOString()}`);

  // 現在の週の月曜リセット（旧基準 UTC 18:00）を求める
  const now = new Date();
  const todayReset = new Date(now);
  todayReset.setUTCHours(OLD_JST_RESET_HOUR_UTC, 0, 0, 0);
  if (now < todayReset) {
    todayReset.setUTCDate(todayReset.getUTCDate() - 1);
  }
  const jstDay = new Date(todayReset.getTime() + 9 * 60 * 60 * 1000);
  const dayOfWeek = jstDay.getUTCDay();
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisWeekStart = new Date(todayReset);
  thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - daysFromMonday);

  // 過去の週を遡って集計（今週は除く）
  let oldWeekStart = new Date(thisWeekStart);
  oldWeekStart.setUTCDate(oldWeekStart.getUTCDate() - 7); // 先週から開始
  let count = 0;

  while (true) {
    const oldWeekEnd = new Date(oldWeekStart);
    oldWeekEnd.setUTCDate(oldWeekEnd.getUTCDate() + 7);

    // 週の終わりが最古のハンドより前なら終了
    if (oldWeekEnd <= oldest.createdAt) break;

    // 新基準のキーに変換
    const weekStart = toNewWeekStart(oldWeekStart);

    // 既存スナップショットがあればスキップ
    const existing = await prisma.weeklyRankingSnapshot.findUnique({
      where: { weekStart },
    });
    if (existing) {
      console.log(`  ${weekStart.toISOString()} — スキップ（既存）`);
      oldWeekStart.setUTCDate(oldWeekStart.getUTCDate() - 7);
      continue;
    }

    // 集計は旧基準の期間で行う
    const rows = await prisma.$queryRaw<Array<{
      userId: string;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
      nameMasked: boolean;
      provider: string;
      handsPlayed: bigint;
      totalAllInEVProfit: bigint;
      winCount: bigint;
    }>>(Prisma.sql`
      SELECT
        hp."userId",
        u."username",
        u."displayName",
        u."avatarUrl",
        u."nameMasked",
        u."provider",
        COUNT(*)                                              AS "handsPlayed",
        SUM(COALESCE(hp."allInEVProfit", hp."profit"))        AS "totalAllInEVProfit",
        SUM(CASE WHEN hp."profit" > 0 THEN 1 ELSE 0 END)     AS "winCount"
      FROM "HandHistoryPlayer" hp
      JOIN "HandHistory" hh ON hp."handHistoryId" = hh."id"
      JOIN "User" u ON hp."userId" = u."id"
      WHERE hp."userId" IS NOT NULL
        AND hh."tournamentId" IS NULL
        AND hh."createdAt" >= ${oldWeekStart}
        AND hh."createdAt" < ${oldWeekEnd}
      GROUP BY hp."userId", u."username", u."displayName", u."avatarUrl", u."nameMasked", u."provider"
      HAVING COUNT(*) >= ${MIN_HANDS}
      ORDER BY "totalAllInEVProfit" DESC
    `);

    const rankings = rows.map(r => ({
      userId: r.userId,
      username: r.displayName ? r.displayName : (r.nameMasked ? maskName(r.username) : r.username),
      avatarUrl: r.avatarUrl ?? null,
      isBot: r.provider === 'bot',
      handsPlayed: Number(r.handsPlayed),
      totalAllInEVProfit: Number(r.totalAllInEVProfit),
      winCount: Number(r.winCount),
    }));

    await prisma.weeklyRankingSnapshot.create({
      data: { weekStart, rankings },
    });
    console.log(`  ${weekStart.toISOString()} — ${rankings.length}人を保存`);
    count++;

    oldWeekStart.setUTCDate(oldWeekStart.getUTCDate() - 7);
  }

  console.log(`\n完了: ${count}週分のスナップショットを生成しました`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
