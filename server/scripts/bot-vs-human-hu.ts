/// <reference types="node" />
/**
 * Bot vs Human のショーダウンHU勝率を調べるスクリプト
 * ショーダウンで最終的にBot1人 vs Human1人になったケースを集計
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-vs-human-hu.ts --prod
 */
import { PrismaClient } from '@prisma/client';

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

async function main() {
  // Bot userIdの一覧を取得
  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true },
  });
  const botIds = new Set(botUsers.map(b => b.id));
  console.log(`Bot数: ${botIds.size}\n`);

  // 直近N日間フィルタ
  const daysArg = process.argv.find(a => a.startsWith('--days='));
  const days = daysArg ? parseInt(daysArg.split('=')[1]) : null;
  const since = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;
  if (since) {
    console.log(`期間: 直近${days}日間 (${since.toISOString().slice(0, 10)} 以降)\n`);
  }

  // ショーダウンでfinalHandがある（＝ショーダウンに参加した）プレイヤーが
  // ちょうど2人のハンドを取得
  const huShowdownHandIds = since
    ? await prisma.$queryRaw<{ handHistoryId: string }[]>`
        SELECT hp."handHistoryId"
        FROM "HandHistoryPlayer" hp
        JOIN "HandHistory" hh ON hh.id = hp."handHistoryId"
        WHERE hp."userId" IS NOT NULL AND hp."finalHand" IS NOT NULL
          AND hh."createdAt" >= ${since}
        GROUP BY hp."handHistoryId"
        HAVING COUNT(*) = 2
      `
    : await prisma.$queryRaw<{ handHistoryId: string }[]>`
        SELECT "handHistoryId"
        FROM "HandHistoryPlayer"
        WHERE "userId" IS NOT NULL AND "finalHand" IS NOT NULL
        GROUP BY "handHistoryId"
        HAVING COUNT(*) = 2
      `;

  console.log(`ショーダウンHUハンド総数: ${huShowdownHandIds.length}`);

  if (huShowdownHandIds.length === 0) {
    console.log('該当ハンドが見つかりません');
    return;
  }

  const handIdList = huShowdownHandIds.map(h => h.handHistoryId);

  const BATCH_SIZE = 1000;
  let botVsHumanCount = 0;
  let botWinCount = 0;
  let humanWinCount = 0;
  let splitCount = 0;
  let botTotalProfit = 0;
  let humanTotalProfit = 0;

  // ブラインド別集計
  const byBlinds: Record<string, { total: number; botWin: number; humanWin: number; split: number; botProfit: number; humanProfit: number }> = {};

  for (let i = 0; i < handIdList.length; i += BATCH_SIZE) {
    const batch = handIdList.slice(i, i + BATCH_SIZE);

    const hands = await prisma.handHistory.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        blinds: true,
        winners: true,
        players: {
          select: {
            userId: true,
            profit: true,
            finalHand: true,
          },
        },
      },
    });

    for (const hand of hands) {
      // ショーダウンに参加したプレイヤー（finalHandあり）
      const showdownPlayers = hand.players.filter(p => p.userId && p.finalHand);
      if (showdownPlayers.length !== 2) continue;

      const [p1, p2] = showdownPlayers;
      const p1IsBot = botIds.has(p1.userId!);
      const p2IsBot = botIds.has(p2.userId!);

      // Bot vs Human のみ（Bot vs Bot, Human vs Human は除外）
      if (p1IsBot === p2IsBot) continue;

      botVsHumanCount++;
      const botPlayer = p1IsBot ? p1 : p2;
      const humanPlayer = p1IsBot ? p2 : p1;

      botTotalProfit += botPlayer.profit;
      humanTotalProfit += humanPlayer.profit;

      const botWon = hand.winners.includes(botPlayer.userId!);
      const humanWon = hand.winners.includes(humanPlayer.userId!);

      if (botWon && humanWon) {
        splitCount++;
      } else if (botWon) {
        botWinCount++;
      } else if (humanWon) {
        humanWinCount++;
      }

      // ブラインド別
      const blinds = hand.blinds;
      if (!byBlinds[blinds]) {
        byBlinds[blinds] = { total: 0, botWin: 0, humanWin: 0, split: 0, botProfit: 0, humanProfit: 0 };
      }
      byBlinds[blinds].total++;
      byBlinds[blinds].botProfit += botPlayer.profit;
      byBlinds[blinds].humanProfit += humanPlayer.profit;
      if (botWon && humanWon) {
        byBlinds[blinds].split++;
      } else if (botWon) {
        byBlinds[blinds].botWin++;
      } else if (humanWon) {
        byBlinds[blinds].humanWin++;
      }
    }

    if ((i + BATCH_SIZE) % 5000 === 0) {
      process.stdout.write(`  処理中... ${Math.min(i + BATCH_SIZE, handIdList.length)}/${handIdList.length}\r`);
    }
  }

  console.log(`\n=== Bot vs Human ショーダウンHU 勝率 ===\n`);
  console.log(`Bot vs Human ショーダウンHUハンド数: ${botVsHumanCount}`);
  console.log(`  Bot勝ち:   ${botWinCount} (${(botWinCount / botVsHumanCount * 100).toFixed(1)}%)`);
  console.log(`  Human勝ち: ${humanWinCount} (${(humanWinCount / botVsHumanCount * 100).toFixed(1)}%)`);
  console.log(`  スプリット: ${splitCount} (${(splitCount / botVsHumanCount * 100).toFixed(1)}%)`);
  console.log(`\n  Bot総損益:   ${botTotalProfit >= 0 ? '+' : ''}${botTotalProfit}`);
  console.log(`  Human総損益: ${humanTotalProfit >= 0 ? '+' : ''}${humanTotalProfit}`);

  // ブラインド別
  const sortedBlinds = Object.entries(byBlinds).sort((a, b) => {
    const aNum = parseInt(a[0].split('/')[0]);
    const bNum = parseInt(b[0].split('/')[0]);
    return aNum - bNum;
  });

  if (sortedBlinds.length > 1) {
    console.log(`\n=== ブラインド別内訳 ===\n`);
    for (const [blinds, stats] of sortedBlinds) {
      console.log(`[${blinds}] ${stats.total}ハンド`);
      console.log(`  Bot勝ち: ${stats.botWin} (${(stats.botWin / stats.total * 100).toFixed(1)}%)  Human勝ち: ${stats.humanWin} (${(stats.humanWin / stats.total * 100).toFixed(1)}%)  Split: ${stats.split}`);
      console.log(`  Bot損益: ${stats.botProfit >= 0 ? '+' : ''}${stats.botProfit}  Human損益: ${stats.humanProfit >= 0 ? '+' : ''}${stats.humanProfit}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
