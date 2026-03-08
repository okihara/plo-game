/// <reference types="node" />
/**
 * ハンド履歴を取得して表示するスクリプト
 *
 * 実行: cd server && npx tsx scripts/query-hand.ts --prod <handId>
 */
import { PrismaClient } from '@prisma/client';

const isProd = process.argv.includes('--prod');
const handId = process.argv.filter(a => !a.startsWith('--')).pop();

if (!handId) {
  console.error('Usage: npx tsx scripts/query-hand.ts [--prod] <handId>');
  process.exit(1);
}

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
  let hand = await prisma.handHistory.findUnique({
    where: { id: handId! },
    include: { players: true },
  });

  // 見つからない場合は前方一致で検索
  if (!hand) {
    const candidates = await prisma.handHistory.findMany({
      where: { id: { startsWith: handId! } },
      include: { players: true },
      take: 1,
    });
    if (candidates.length > 0) hand = candidates[0];
  }

  // handNumberで検索
  if (!hand) {
    const byNumber = await prisma.handHistory.findMany({
      where: { handNumber: parseInt(handId!, 10) || -1 },
      include: { players: true },
      take: 1,
    });
    if (byNumber.length > 0) hand = byNumber[0];
  }

  // LIKE検索
  if (!hand) {
    const byContains = await prisma.handHistory.findMany({
      where: { id: { contains: handId! } },
      include: { players: true },
      take: 5,
    });
    if (byContains.length > 0) {
      console.log(`部分一致: ${byContains.map(h => h.id).join(', ')}`);
      hand = byContains[0];
    }
  }

  if (!hand) {
    console.log(`Hand ${handId} not found`);
    return;
  }

  console.log(`=== Hand: ${hand.id} (#${hand.handNumber}) ===`);
  console.log(`Blinds: ${hand.blinds}`);
  console.log(`Community: ${hand.communityCards}`);
  console.log(`Pot: ${hand.potSize}`);
  console.log(`Winners: ${hand.winners}`);
  console.log(`Created: ${hand.createdAt}`);

  // アクションからseatIndex→odNameマップを作成
  const seatNameMap = new Map<number, string>();
  const seatCardsMap = new Map<string, string>(); // odId → holeCards
  if (Array.isArray(hand.actions)) {
    for (const a of hand.actions as any[]) {
      if (a.seatIndex !== undefined && a.odName) seatNameMap.set(a.seatIndex, a.odName);
      if (a.odId) seatCardsMap.set(a.odId, '');
    }
  }
  // プレイヤーのカード情報をodIdベースでマッチ
  for (const p of hand.players) {
    seatCardsMap.set(p.userId, p.holeCards || '');
  }

  console.log(`\n--- Players ---`);
  for (const p of hand.players) {
    // アクションからseatIndexとnameを逆引き
    let seatIdx = p.seatIndex;
    let name = p.displayName || '';
    if (!name) {
      for (const a of (hand.actions as any[] || [])) {
        if (a.odId === p.userId && a.odName) { name = a.odName; seatIdx = a.seatIndex; break; }
      }
    }
    if (!name) name = p.userId.slice(-8);
    console.log(`  seat${seatIdx ?? '?'}: ${name.padEnd(16)} cards=[${p.holeCards}]  chipChange=${p.chipChange}`);
  }

  // Raw data debug
  console.log(`\n--- Raw action sample ---`);
  const rawActions = hand.actions as any;
  if (Array.isArray(rawActions) && rawActions.length > 0) {
    console.log(JSON.stringify(rawActions[0], null, 2));
    console.log(`(${rawActions.length} actions total)`);
  }
  console.log(`\n--- Raw player sample ---`);
  if (hand.players.length > 0) {
    const p = hand.players[0];
    console.log(`  seatIndex=${p.seatIndex}, userId=${p.userId}, displayName=${p.displayName}`);
  }

  console.log(`\n--- Actions ---`);
  const actions = hand.actions as any;
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const streetLabel = a.street ? `[${a.street.padEnd(7)}]` : '[       ]';
      const name = a.odName || a.odId?.slice(-8) || `seat${a.seatIndex ?? a.playerId}`;
      const amount = a.amount ? ` ${a.amount}` : '';
      console.log(`  ${streetLabel} seat${a.seatIndex ?? '?'} ${name.padEnd(16)} ${a.action}${amount}`);
    }
  } else {
    console.log(JSON.stringify(actions, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
