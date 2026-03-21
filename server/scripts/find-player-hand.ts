/// <reference types="node" />
/**
 * 特定プレイヤーの特定ホールカードを持つハンド履歴を検索するスクリプト
 *
 * 実行: cd server && npx tsx scripts/find-player-hand.ts --prod --username 2Ryannpe --cards 6h9s8dTh
 */
import { PrismaClient } from '@prisma/client';

const isProd = process.argv.includes('--prod');

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const username = getArg('username');
const cardsArg = getArg('cards');

if (!username || !cardsArg) {
  console.error('Usage: npx tsx scripts/find-player-hand.ts [--prod] --username <name> --cards <cards>');
  console.error('Example: npx tsx scripts/find-player-hand.ts --prod --username 2Ryannpe --cards 6h9s8dTh');
  process.exit(1);
}

// カード文字列をパース: "6h9s8dTh" → ["6h", "9s", "8d", "Th"]
function parseCards(s: string): string[] {
  const cards: string[] = [];
  let i = 0;
  while (i < s.length) {
    // ランク部分: T, J, Q, K, A or 2-9 (1文字), 10は"T"表記
    const rank = s[i];
    const suit = s[i + 1];
    if (!rank || !suit) break;
    cards.push(rank + suit);
    i += 2;
  }
  return cards;
}

const searchCards = parseCards(cardsArg);
console.log(`検索条件: username=${username}, cards=${searchCards.join(', ')}`);

if (isProd) {
  const url = process.env.DATABASE_PROD_PUBLIC_URL;
  if (!url) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.log('本番DBに接続\n');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

async function main() {
  // まずusernameでユーザーを検索
  const user = await prisma.user.findFirst({
    where: { username },
  });

  if (!user) {
    // usernameが見つからない場合、HandHistoryPlayerのusernameフィールドで直接検索
    console.log(`User "${username}" がUserテーブルに見つかりません。HandHistoryPlayerのusernameで検索します...\n`);
  } else {
    console.log(`User found: id=${user.id}, displayName=${user.displayName}, username=${user.username}\n`);
  }

  // HandHistoryPlayerから検索
  // holeCardsはString[]なので、hasEveryで全カードを含むレコードを検索
  const playerHands = await prisma.handHistoryPlayer.findMany({
    where: {
      ...(user ? { userId: user.id } : { username }),
      holeCards: { hasEvery: searchCards },
    },
    include: {
      handHistory: {
        include: { players: true },
      },
    },
    orderBy: { handHistory: { createdAt: 'desc' } },
    take: 20,
  });

  if (playerHands.length === 0) {
    console.log('該当するハンドが見つかりませんでした');
    return;
  }

  console.log(`=== ${playerHands.length} 件のハンドが見つかりました ===\n`);

  for (const ph of playerHands) {
    const hand = ph.handHistory;
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Hand: ${hand.id} (#${hand.handNumber})`);
    console.log(`Date: ${hand.createdAt}`);
    console.log(`Blinds: ${hand.blinds}`);
    console.log(`Community: ${hand.communityCards.join(' ')}`);
    console.log(`Pot: ${hand.potSize}`);
    console.log(`Winners: ${hand.winners.join(', ')}`);
    console.log(`Dealer: seat${hand.dealerPosition}`);

    console.log(`\n--- Players ---`);
    for (const p of hand.players) {
      const isTarget = p.id === ph.id;
      const marker = isTarget ? ' ★' : '';
      const name = p.username || p.userId?.slice(-8) || '???';
      const evProfit = p.allInEVProfit != null ? ` (EV: ${p.allInEVProfit > 0 ? '+' : ''}${p.allInEVProfit})` : '';
      console.log(`  seat${p.seatPosition}: ${name.padEnd(18)} [${p.holeCards.join(' ')}]  profit=${p.profit > 0 ? '+' : ''}${p.profit}${evProfit}  ${p.finalHand || ''}${marker}`);
    }

    console.log(`\n--- Actions ---`);
    const actions = hand.actions as any[];
    if (Array.isArray(actions)) {
      for (const a of actions) {
        const streetLabel = a.street ? `[${a.street.padEnd(7)}]` : '[       ]';
        const name = a.odName || a.odId?.slice(-8) || `seat${a.seatIndex ?? a.playerId}`;
        const amount = a.amount ? ` ${a.amount}` : '';
        console.log(`  ${streetLabel} seat${a.seatIndex ?? '?'} ${name.padEnd(18)} ${a.action}${amount}`);
      }
    }
    console.log('');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
