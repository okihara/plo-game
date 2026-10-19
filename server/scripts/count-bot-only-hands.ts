/// <reference types="node" />
/**
 * Bot しか参加していないハンド（HandHistory）の件数を月別・リング/トナメ別に推定する（読み取り専用）
 * 全件走査は重いので HandHistory を TABLESAMPLE で抜き取り、件数は抜き取り率で割り戻す。
 *
 * 実行:
 *   cd server && npx tsx scripts/count-bot-only-hands.ts --prod [--sample=2]   # sample は % (既定 2)
 */
import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient, Prisma } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const isProd = process.argv.includes('--prod');
const samplePct = Number(process.argv.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? 2);

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
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
  const rows = await prisma.$queryRaw<
    { month: string; kind: string; hands: bigint; bot_only: bigint; bot_only_players: bigint }[]
  >(Prisma.sql`
    WITH s AS (
      SELECT h.id, h."createdAt", h."tournamentId"
      FROM "HandHistory" h TABLESAMPLE SYSTEM (${samplePct})
    ),
    flagged AS (
      SELECT s.*,
        NOT EXISTS (
          SELECT 1 FROM "HandHistoryPlayer" p
          LEFT JOIN "User" u ON u.id = p."userId"
          WHERE p."handHistoryId" = s.id AND u.provider IS DISTINCT FROM 'bot'
        ) AS bot_only,
        (SELECT count(*) FROM "HandHistoryPlayer" p WHERE p."handHistoryId" = s.id) AS players
      FROM s
    )
    SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
      CASE WHEN "tournamentId" IS NULL THEN 'ring' ELSE 'tourney' END AS kind,
      count(*) AS hands,
      count(*) FILTER (WHERE bot_only) AS bot_only,
      COALESCE(sum(players) FILTER (WHERE bot_only), 0) AS bot_only_players
    FROM flagged
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const scale = 100 / samplePct;
  const fmt = (n: number) => Math.round(n * scale).toLocaleString();
  console.log(`サンプル率 ${samplePct}% （件数は ×${scale} で割り戻した推定値）\n`);
  console.log('month   kind     hands(推定)  bot_only(推定)  bot_only率  bot_only HHP行(推定)');
  let tot = 0, totBot = 0, totBotP = 0;
  for (const r of rows) {
    const h = Number(r.hands), b = Number(r.bot_only), bp = Number(r.bot_only_players);
    tot += h; totBot += b; totBotP += bp;
    console.log(
      `${r.month} ${r.kind.padEnd(8)} ${fmt(h).padStart(11)} ${fmt(b).padStart(15)} ${((b / h) * 100).toFixed(1).padStart(9)}% ${fmt(bp).padStart(18)}`,
    );
  }
  console.log(
    `\n合計: hands≈${fmt(tot)} bot_only≈${fmt(totBot)} (${((totBot / tot) * 100).toFixed(1)}%) bot_only HHP行≈${fmt(totBotP)}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
