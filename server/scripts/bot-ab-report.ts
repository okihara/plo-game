/// <reference types="node" />
/**
 * Bot エンジン A/B レポート (bot-redesign Phase 3)
 *
 * リング PLO4 の Bot 損益を、エンジン割当 (v1=旧 / v2=EVエンジン) 別に集計する。
 * 割当は engineSelector と同じ決定的ハッシュを providerId (=BotClient名) に適用して再現する。
 * BOT_ENGINE_V2_RATIO を本番と変えている場合は同じ値を env で指定すること。
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-ab-report.ts --prod [--days 1]
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getEngineForBot, v2Ratio } from '../src/shared/logic/ai2/engineSelector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const daysArgIdx = process.argv.indexOf('--days');
const DAYS = daysArgIdx >= 0 ? Number(process.argv[daysArgIdx + 1]) : 1;

if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

interface GroupAgg {
  bots: Set<string>;
  hands: number;
  profit: number;
  profitBB: number;
  humanHands: number;
  humanProfit: number;
  humanProfitBB: number;
}

function emptyAgg(): GroupAgg {
  return { bots: new Set(), hands: 0, profit: 0, profitBB: 0, humanHands: 0, humanProfit: 0, humanProfitBB: 0 };
}

async function main() {
  console.log(`🧪 Bot A/B レポート (${isProd ? '本番' : 'ローカル'} / 直近${DAYS}日 / リングPLO4)`);
  console.log(`v2 割当比率 (BOT_ENGINE_V2_RATIO): ${(v2Ratio() * 100).toFixed(0)}%\n`);

  const bots = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true, providerId: true },
  });
  const engineByUserId = new Map<string, 'v1' | 'v2'>();
  for (const b of bots) {
    engineByUserId.set(b.id, getEngineForBot(b.providerId ?? ''));
  }
  const v2Count = [...engineByUserId.values()].filter(e => e === 'v2').length;
  console.log(`Bot ${bots.length} 体 (割当: v2 ${v2Count} / v1 ${bots.length - v2Count})`);

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const groups: Record<'v1' | 'v2', GroupAgg> = { v1: emptyAgg(), v2: emptyAgg() };
  let handsScanned = 0;

  let cursor: string | null = null;
  for (;;) {
    const batch: Array<{
      id: string;
      blinds: string;
      communityCards2: string[];
      players: Array<{ userId: string | null; holeCards: string[]; profit: number }>;
    }> = await prisma.handHistory.findMany({
      where: { createdAt: { gte: since }, tournamentId: null },
      select: {
        id: true,
        blinds: true,
        communityCards2: true,
        players: { select: { userId: true, holeCards: true, profit: true } },
      },
      orderBy: { id: 'asc' },
      take: 1000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    for (const hand of batch) {
      handsScanned++;
      if (hand.communityCards2.length > 0) continue;
      if (!hand.players.every(p => p.holeCards.length === 4)) continue;
      const bb = Number(hand.blinds.split('/')[1]);
      if (!Number.isFinite(bb) || bb <= 0) continue;

      const hasHuman = hand.players.some(
        p => p.userId != null && !engineByUserId.has(p.userId) && !p.userId.startsWith('guest')
      );

      for (const p of hand.players) {
        if (!p.userId) continue;
        const engine = engineByUserId.get(p.userId);
        if (!engine) continue;
        const g = groups[engine];
        g.bots.add(p.userId);
        g.hands++;
        g.profit += p.profit;
        g.profitBB += p.profit / bb;
        if (hasHuman) {
          g.humanHands++;
          g.humanProfit += p.profit;
          g.humanProfitBB += p.profit / bb;
        }
      }
    }
    process.stdout.write(`\r走査 ${handsScanned} ハンド`);
  }
  console.log('\n');

  console.log(
    'エンジン'.padEnd(8) + 'bots'.padStart(6) + 'hands'.padStart(9) + 'profit'.padStart(10) + 'BB/100'.padStart(9) +
    ' | 人間同席:' + 'hands'.padStart(8) + 'profit'.padStart(10) + 'BB/100'.padStart(9)
  );
  for (const engine of ['v1', 'v2'] as const) {
    const g = groups[engine];
    const bb100 = g.hands > 0 ? (g.profitBB / g.hands) * 100 : 0;
    const hBB100 = g.humanHands > 0 ? (g.humanProfitBB / g.humanHands) * 100 : 0;
    console.log(
      engine.padEnd(8) +
      String(g.bots.size).padStart(6) +
      String(g.hands).padStart(9) +
      String(g.profit).padStart(10) +
      bb100.toFixed(1).padStart(9) +
      ' |          ' +
      String(g.humanHands).padStart(8) +
      String(g.humanProfit).padStart(10) +
      hBB100.toFixed(1).padStart(9)
    );
  }
  console.log('\n判定の目安: 人間同席 BB/100 で v2 > v1 が数日続けば割当拡大、逆なら BOT_ENGINE_V2_RATIO=0 で停止。');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
