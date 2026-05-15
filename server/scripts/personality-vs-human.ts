/**
 * Personality ごとの対人間成績を集計する。
 * bot-vs-human-by-bot.ts のロジックをベースに、ハッシュで TatsuyaN/YuHayashi/yuna0312 に分けて集計。
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

function nameHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

const PERSONALITY_NAMES = ['TatsuyaN', 'YuHayashi', 'yuna0312'];
function getPersonalityName(botName: string): string {
  return PERSONALITY_NAMES[nameHash(botName) % 3];
}

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true, username: true },
  });
  const botIds = botUsers.map(b => b.id);
  const botIdSet = new Set(botIds);
  const botById = new Map(botUsers.map(b => [b.id, b]));
  console.error(`Bot 数: ${botUsers.length}, 期間: 直近${hours}h`);

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

  const vsHumanHands = hands.filter(h =>
    h.players.some(p => p.userId !== null && !botIdSet.has(p.userId))
  );
  console.error(`対人間ハンド: ${vsHumanHands.length}`);

  type Agg = {
    hands: number;
    profit: number;
    bbWeightedProfit: number;
    bbWeightedHands: number;
    sdHU: number;
    sdHUWin: number;
    sdHULoss: number;
    sdHUSplit: number;
    botCount: Set<string>;
  };
  const personalityAgg = new Map<string, Agg>();
  for (const p of PERSONALITY_NAMES) {
    personalityAgg.set(p, {
      hands: 0, profit: 0, bbWeightedProfit: 0, bbWeightedHands: 0,
      sdHU: 0, sdHUWin: 0, sdHULoss: 0, sdHUSplit: 0,
      botCount: new Set(),
    });
  }

  for (const h of vsHumanHands) {
    const bb = bbFromBlinds(h.blinds);
    const botPlayers = h.players.filter(p => p.userId && botIdSet.has(p.userId));

    for (const bp of botPlayers) {
      const bot = botById.get(bp.userId!);
      if (!bot) continue;
      const pname = getPersonalityName(bot.username);
      const e = personalityAgg.get(pname)!;
      e.hands += 1;
      e.profit += bp.profit;
      e.bbWeightedProfit += bp.profit / bb;
      e.bbWeightedHands += 1;
      e.botCount.add(bot.id);
    }

    const sd = h.players.filter(p => p.userId && p.finalHand);
    if (sd.length !== 2) continue;
    const sdBots = sd.filter(p => botIdSet.has(p.userId!));
    if (sdBots.length !== 1) continue;
    const botP = sdBots[0];
    const humanP = sd.find(p => p.userId !== botP.userId)!;
    if (!botP.userId || !humanP.userId) continue;
    if (botIdSet.has(humanP.userId)) continue;

    const bot = botById.get(botP.userId);
    if (!bot) continue;
    const pname = getPersonalityName(bot.username);
    const e = personalityAgg.get(pname)!;
    const botWon = h.winners.includes(botP.userId);
    const humanWon = h.winners.includes(humanP.userId);
    e.sdHU += 1;
    if (botWon && humanWon) e.sdHUSplit += 1;
    else if (botWon) e.sdHUWin += 1;
    else if (humanWon) e.sdHULoss += 1;
  }

  console.log(`\n## Personality 別 対人間成績（直近 ${hours}h）\n`);
  console.log(`| Personality | bot 数 | Hands | Profit | BB/100 | sdHU | Win/Loss/Split | sdWin% |`);
  console.log(`|---|---:|---:|---:|---:|---:|---|---:|`);
  for (const p of PERSONALITY_NAMES) {
    const a = personalityAgg.get(p)!;
    const bb100 = a.bbWeightedHands > 0 ? (a.bbWeightedProfit / a.bbWeightedHands) * 100 : 0;
    const sdWin = a.sdHU > 0 ? (a.sdHUWin / a.sdHU) * 100 : 0;
    console.log(`| ${p} | ${a.botCount.size} | ${a.hands} | ${a.profit} | ${bb100.toFixed(1)} | ${a.sdHU} | ${a.sdHUWin}/${a.sdHULoss}/${a.sdHUSplit} | ${sdWin.toFixed(1)}% |`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
