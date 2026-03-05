/// <reference types="node" />
/**
 * BotのdisplayName設定状況を確認するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-displayname-check.ts --prod
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
  const bots = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { username: true, displayName: true, nameMasked: true },
    orderBy: { username: 'asc' },
  });

  const withDisplay = bots.filter(b => b.displayName);
  const withoutDisplay = bots.filter(b => !b.displayName);

  console.log(`=== Bot総数: ${bots.length} ===`);
  console.log(`  displayNameあり: ${withDisplay.length}`);
  console.log(`  displayNameなし: ${withoutDisplay.length}\n`);

  if (withoutDisplay.length > 0) {
    console.log('--- displayNameなし ---');
    for (const b of withoutDisplay) {
      const masked = b.nameMasked ? ' (masked)' : '';
      console.log(`  username: ${b.username}${masked}`);
    }
  }

  if (withDisplay.length > 0) {
    console.log('\n--- displayNameあり ---');
    for (const b of withDisplay) {
      const same = b.username === b.displayName ? '' : ` (username: ${b.username})`;
      console.log(`  ${b.displayName}${same}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
