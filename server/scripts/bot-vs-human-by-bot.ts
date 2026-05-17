/// <reference types="node" />
/**
 * Bot 別の対人間成績を集計するスクリプト。
 *
 * 「対人間ハンド」= テーブルに登録ユーザー（bot 以外の userId 持ち）が
 * 1 人以上参加していたハンド。guest（userId=null）は人間扱いしない。
 *
 *   cd server && npx tsx scripts/bot-vs-human-by-bot.ts                 # ローカルDB、直近24h
 *   cd server && npx tsx scripts/bot-vs-human-by-bot.ts --prod          # 本番DB、直近24h
 *   cd server && npx tsx scripts/bot-vs-human-by-bot.ts --prod --hours=168
 *   cd server && npx tsx scripts/bot-vs-human-by-bot.ts --prod --min-hands=20
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const hoursArg = process.argv.find(a => a.startsWith('--hours='));
const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;
const minHandsArg = process.argv.find(a => a.startsWith('--min-hands='));
const minHands = minHandsArg ? Number(minHandsArg.split('=')[1]) : 30;

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

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true, username: true, displayName: true },
  });
  const botIds = botUsers.map(b => b.id);
  const botIdSet = new Set(botIds);
  const botById = new Map(botUsers.map(b => [b.id, b]));
  console.error(`Bot 数: ${botUsers.length}, 期間: 直近${hours}h, min-hands=${minHands}`);

  const handIdRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT hh.id
    FROM "HandHistory" hh
    JOIN "HandHistoryPlayer" hp ON hp."handHistoryId" = hh.id
    WHERE hh."tournamentId" IS NULL
      AND hh."createdAt" >= ${since}
      AND hp."userId" = ANY(${botIds}::text[])
  `;
  const handIds = handIdRows.map(r => r.id);
  console.error(`bot 参加ハンド総数: ${handIds.length}`);

  if (handIds.length === 0) return;

  const BATCH = 500;
  type HandRow = {
    id: string;
    blinds: string;
    winners: string[];
    players: Array<{ userId: string | null; profit: number; finalHand: string | null }>;
  };
  const hands: HandRow[] = [];
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
    for (const h of chunk) hands.push(h);
  }

  // 「対人間ハンド」= bot 以外の userId を持つプレイヤーが 1 人以上参加
  // guest（userId=null）は除外
  const vsHumanHands = hands.filter(h =>
    h.players.some(p => p.userId !== null && !botIdSet.has(p.userId))
  );
  console.error(`うち、対人間ハンド（登録ユーザーが同卓）: ${vsHumanHands.length}`);

  type Agg = {
    userId: string;
    username: string;
    displayName: string;
    hands: number;
    profit: number;
    bbWeightedProfit: number; // ブラインド帯ごとに BB 単位換算
    bbWeightedHands: number;
    sdHU: number; // bot 1 + human 1 で showdown まで行ったハンド数
    sdHUWin: number;
    sdHULoss: number;
    sdHUSplit: number;
  };
  const agg = new Map<string, Agg>();

  for (const h of vsHumanHands) {
    const bb = bbFromBlinds(h.blinds);
    const botPlayers = h.players.filter(p => p.userId && botIdSet.has(p.userId));

    // bot 別の集計（ハンド単位）
    for (const bp of botPlayers) {
      const bot = botById.get(bp.userId!);
      if (!bot) continue;
      const e = agg.get(bot.id) ?? {
        userId: bot.id,
        username: bot.username,
        displayName: bot.displayName ?? bot.username,
        hands: 0, profit: 0, bbWeightedProfit: 0, bbWeightedHands: 0,
        sdHU: 0, sdHUWin: 0, sdHULoss: 0, sdHUSplit: 0,
      };
      e.hands += 1;
      e.profit += bp.profit;
      e.bbWeightedProfit += bp.profit / bb;
      e.bbWeightedHands += 1;
      agg.set(bot.id, e);
    }

    // HU showdown: showdown 参加者がちょうど 2 人かつ bot 1 + human 1 のときだけ集計
    const sd = h.players.filter(p => p.userId && p.finalHand);
    if (sd.length !== 2) continue;
    const sdBots = sd.filter(p => botIdSet.has(p.userId!));
    if (sdBots.length !== 1) continue;
    const botP = sdBots[0];
    const humanP = sd.find(p => p.userId !== botP.userId)!;
    if (!botP.userId || !humanP.userId) continue;
    if (botIdSet.has(humanP.userId)) continue; // 人間限定

    const e = agg.get(botP.userId);
    if (!e) continue;
    const botWon = h.winners.includes(botP.userId);
    const humanWon = h.winners.includes(humanP.userId);
    e.sdHU += 1;
    if (botWon && humanWon) e.sdHUSplit += 1;
    else if (botWon) e.sdHUWin += 1;
    else if (humanWon) e.sdHULoss += 1;
  }

  const results = [...agg.values()].filter(a => a.hands >= minHands);

  // 出力 1: bb/100 ベスト
  const byBB100 = results.map(a => ({
    ...a,
    bb100: a.bbWeightedHands > 0 ? (a.bbWeightedProfit / a.bbWeightedHands) * 100 : 0,
    sdWinRate: a.sdHU > 0 ? (a.sdHUWin / a.sdHU) * 100 : 0,
  }));

  console.log(`\n## Bot 別 対人間成績（直近 ${hours}h, hands>=${minHands}）\n`);
  console.log(`集計対象 bot 数: ${byBB100.length}`);
  const totalHands = byBB100.reduce((s, a) => s + a.hands, 0);
  const totalProfit = byBB100.reduce((s, a) => s + a.profit, 0);
  console.log(`合計 対人間ハンド数: ${totalHands}, bot 合計損益: ${totalProfit}`);

  // ベスト 20 (BB/100)
  const sortedBB = [...byBB100].sort((a, b) => b.bb100 - a.bb100);
  console.log(`\n### 対人間 BB/100 ベスト 20`);
  console.log(`| Bot | Hands | Profit | BB/100 | sdHU | sdWin% |`);
  console.log(`|---|---:|---:|---:|---:|---:|`);
  for (const a of sortedBB.slice(0, 20)) {
    console.log(`| ${a.username} | ${a.hands} | ${a.profit} | ${a.bb100.toFixed(1)} | ${a.sdHU} | ${a.sdWinRate.toFixed(1)}% |`);
  }

  // showdown HU 勝率の高い順（最低 sdHU >= 10）
  const sortedSD = byBB100.filter(a => a.sdHU >= 10).sort((a, b) => b.sdWinRate - a.sdWinRate);
  console.log(`\n### 対人間 HU showdown 勝率ベスト 20 (sdHU>=10)`);
  console.log(`| Bot | sdHU | Win% | Win/Loss/Split | Hands | BB/100 |`);
  console.log(`|---|---:|---:|---|---:|---:|`);
  for (const a of sortedSD.slice(0, 20)) {
    console.log(`| ${a.username} | ${a.sdHU} | ${a.sdWinRate.toFixed(1)}% | ${a.sdHUWin}/${a.sdHULoss}/${a.sdHUSplit} | ${a.hands} | ${a.bb100.toFixed(1)} |`);
  }

  // ワースト 20 (BB/100)
  console.log(`\n### 対人間 BB/100 ワースト 20`);
  console.log(`| Bot | Hands | Profit | BB/100 | sdHU | sdWin% |`);
  console.log(`|---|---:|---:|---:|---:|---:|`);
  for (const a of [...sortedBB].reverse().slice(0, 20)) {
    console.log(`| ${a.username} | ${a.hands} | ${a.profit} | ${a.bb100.toFixed(1)} | ${a.sdHU} | ${a.sdWinRate.toFixed(1)}% |`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
