/// <reference types="node" />
/**
 * Bot 改修の前後で対人間成績を比較するスクリプト。
 *
 * 「対人間ハンド」= テーブルに登録ユーザー（bot 以外の userId 持ち）が
 * 1 人以上参加していたリングのハンド。guest（userId=null）は人間扱いしない。
 *
 *   cd server && npx tsx scripts/bot-before-after-compare.ts --prod \
 *     --boundary=2026-08-06T14:00:00+09:00 --days=11
 *
 * --boundary: 改修が本番反映された日時（この時刻を境に before/after を分ける）
 * --days:     境界の前後それぞれ何日分を集計するか（既定 7）
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const boundaryArg = process.argv.find(a => a.startsWith('--boundary='));
const daysArg = process.argv.find(a => a.startsWith('--days='));
if (!boundaryArg) {
  console.error('ERROR: --boundary=<ISO日時> を指定してください');
  process.exit(1);
}
const boundary = new Date(boundaryArg.split('=')[1]);
if (isNaN(boundary.getTime())) {
  console.error('ERROR: --boundary の日時が不正です');
  process.exit(1);
}
const days = daysArg ? Number(daysArg.split('=')[1]) : 7;
const spanMs = days * 24 * 60 * 60 * 1000;

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

function bbFromBlinds(blinds: string): number {
  const parts = blinds.split('/');
  return Number(parts[1] ?? parts[0]) || 1;
}

interface PeriodAgg {
  label: string;
  from: Date;
  to: Date;
  vsHumanHands: number;
  profit: number;
  bbWeightedProfit: number;
  sdHU: number;
  sdHUWin: number;
  sdHULoss: number;
  sdHUSplit: number;
  byBlinds: Map<string, { hands: number; profit: number; bbProfit: number }>;
}

async function aggregatePeriod(
  label: string,
  from: Date,
  to: Date,
  botIds: string[],
  botIdSet: Set<string>
): Promise<PeriodAgg> {
  const handIdRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT hh.id
    FROM "HandHistory" hh
    JOIN "HandHistoryPlayer" hp ON hp."handHistoryId" = hh.id
    WHERE hh."tournamentId" IS NULL
      AND hh."createdAt" >= ${from}
      AND hh."createdAt" < ${to}
      AND hp."userId" = ANY(${botIds}::text[])
  `;
  const handIds = handIdRows.map(r => r.id);
  console.error(`[${label}] bot 参加ハンド総数: ${handIds.length}`);

  const agg: PeriodAgg = {
    label, from, to,
    vsHumanHands: 0, profit: 0, bbWeightedProfit: 0,
    sdHU: 0, sdHUWin: 0, sdHULoss: 0, sdHUSplit: 0,
    byBlinds: new Map(),
  };

  const BATCH = 500;
  for (let i = 0; i < handIds.length; i += BATCH) {
    const batch = handIds.slice(i, i + BATCH);
    const chunk = await prisma.handHistory.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        blinds: true,
        winners: true,
        players: { select: { userId: true, profit: true, finalHand: true } },
      },
    });

    for (const h of chunk) {
      // 対人間ハンドのみ
      if (!h.players.some(p => p.userId !== null && !botIdSet.has(p.userId))) continue;
      const bb = bbFromBlinds(h.blinds);
      const botPlayers = h.players.filter(p => p.userId && botIdSet.has(p.userId));

      agg.vsHumanHands += 1;
      const bl = agg.byBlinds.get(h.blinds) ?? { hands: 0, profit: 0, bbProfit: 0 };
      bl.hands += 1;
      for (const bp of botPlayers) {
        agg.profit += bp.profit;
        agg.bbWeightedProfit += bp.profit / bb;
        bl.profit += bp.profit;
        bl.bbProfit += bp.profit / bb;
      }
      agg.byBlinds.set(h.blinds, bl);

      // HU showdown: showdown 参加者がちょうど 2 人かつ bot 1 + human 1
      const sd = h.players.filter(p => p.userId && p.finalHand);
      if (sd.length !== 2) continue;
      const sdBots = sd.filter(p => botIdSet.has(p.userId!));
      if (sdBots.length !== 1) continue;
      const botP = sdBots[0];
      const humanP = sd.find(p => p.userId !== botP.userId)!;
      if (!botP.userId || !humanP.userId) continue;
      if (botIdSet.has(humanP.userId)) continue;

      const botWon = h.winners.includes(botP.userId);
      const humanWon = h.winners.includes(humanP.userId);
      agg.sdHU += 1;
      if (botWon && humanWon) agg.sdHUSplit += 1;
      else if (botWon) agg.sdHUWin += 1;
      else if (humanWon) agg.sdHULoss += 1;
    }
  }
  return agg;
}

function fmtPeriod(a: PeriodAgg): void {
  const bb100 = a.vsHumanHands > 0 ? (a.bbWeightedProfit / a.vsHumanHands) * 100 : 0;
  const sdWin = a.sdHU > 0 ? (a.sdHUWin / a.sdHU) * 100 : 0;
  console.log(`\n### ${a.label}（${a.from.toISOString()} 〜 ${a.to.toISOString()}）\n`);
  console.log(`- 対人間ハンド数: ${a.vsHumanHands}`);
  console.log(`- bot 合計損益: ${a.profit}（BB換算 ${a.bbWeightedProfit.toFixed(0)}bb）`);
  console.log(`- bot BB/100（対人間ハンドあたり）: ${bb100.toFixed(2)}`);
  console.log(`- HU showdown: ${a.sdHU}（勝率 ${sdWin.toFixed(1)}% = ${a.sdHUWin}W/${a.sdHULoss}L/${a.sdHUSplit}S）`);
  console.log(`\n| Blinds | Hands | Bot Profit | Bot BB/100 |`);
  console.log(`|---|---:|---:|---:|`);
  const sorted = [...a.byBlinds.entries()].sort((x, y) => bbFromBlinds(x[0]) - bbFromBlinds(y[0]));
  for (const [blinds, v] of sorted) {
    const b = v.hands > 0 ? (v.bbProfit / v.hands) * 100 : 0;
    console.log(`| ${blinds} | ${v.hands} | ${v.profit} | ${b.toFixed(2)} |`);
  }
}

async function main() {
  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true },
  });
  const botIds = botUsers.map(b => b.id);
  const botIdSet = new Set(botIds);
  console.error(`Bot 数: ${botUsers.length}, 境界: ${boundary.toISOString()}, 前後 ${days} 日ずつ`);

  const before = await aggregatePeriod(
    '改修前', new Date(boundary.getTime() - spanMs), boundary, botIds, botIdSet);
  const after = await aggregatePeriod(
    '改修後', boundary, new Date(Math.min(boundary.getTime() + spanMs, Date.now())), botIds, botIdSet);

  console.log(`\n## Bot 改修 前後比較（境界: ${boundary.toISOString()}）`);
  fmtPeriod(before);
  fmtPeriod(after);

  const bb100Before = before.vsHumanHands > 0 ? (before.bbWeightedProfit / before.vsHumanHands) * 100 : 0;
  const bb100After = after.vsHumanHands > 0 ? (after.bbWeightedProfit / after.vsHumanHands) * 100 : 0;
  console.log(`\n### 差分サマリ\n`);
  console.log(`- BB/100: ${bb100Before.toFixed(2)} → ${bb100After.toFixed(2)}（${(bb100After - bb100Before) >= 0 ? '+' : ''}${(bb100After - bb100Before).toFixed(2)}）`);
  const sdB = before.sdHU > 0 ? (before.sdHUWin / before.sdHU) * 100 : 0;
  const sdA = after.sdHU > 0 ? (after.sdHUWin / after.sdHU) * 100 : 0;
  console.log(`- HU showdown 勝率: ${sdB.toFixed(1)}% → ${sdA.toFixed(1)}%（${(sdA - sdB) >= 0 ? '+' : ''}${(sdA - sdB).toFixed(1)}pt）`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
