/// <reference types="node" />
/**
 * 指定 userId（または部分一致）のユーザー基本情報を表示するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/find-user-info.ts <userId>          # ローカルDB
 *   cd server && npx tsx scripts/find-user-info.ts <userId> --prod   # 本番DB
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const userId = positional[0];

if (!userId) {
  console.error('ERROR: userId を引数で指定してください');
  console.error('  例: npx tsx scripts/find-user-info.ts nOTzIbdyOXs8UqY --prod');
  process.exit(1);
}

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
    process.exit(1);
  }
  console.log('🔗 本番DBに接続します\n');
}

const prisma = new PrismaClient({
  datasources: isProd
    ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } }
    : undefined,
});

function printUser(user: any) {
  console.log('=== User ===');
  console.log(`  id              : ${user.id}`);
  console.log(`  email           : ${user.email}`);
  console.log(`  username        : ${user.username}`);
  console.log(`  displayName     : ${user.displayName ?? '(null)'}`);
  console.log(`  avatarUrl       : ${user.avatarUrl ?? '(null)'}`);
  console.log(`  twitterAvatarUrl: ${user.twitterAvatarUrl ?? '(null)'}`);
  console.log(`  useTwitterAvatar: ${user.useTwitterAvatar}`);
  console.log(`  provider        : ${user.provider}`);
  console.log(`  providerId      : ${user.providerId}`);
  console.log(`  role            : ${user.role}`);
  console.log(`  nameMasked      : ${user.nameMasked}`);
  console.log(`  createdAt       : ${user.createdAt.toISOString()}`);
  console.log(`  updatedAt       : ${user.updatedAt.toISOString()}`);
  console.log(`  lastLoginAt     : ${user.lastLoginAt?.toISOString() ?? '(null)'}`);

  console.log('\n=== Bankroll ===');
  if (user.bankroll) {
    console.log(`  balance   : ${user.bankroll.balance.toLocaleString()}`);
    console.log(`  updatedAt : ${user.bankroll.updatedAt.toISOString()}`);
  } else {
    console.log('  (なし)');
  }
}

async function main() {
  // まず完全一致
  const exact = await prisma.user.findUnique({
    where: { id: userId },
    include: { bankroll: true },
  });

  if (exact) {
    printUser(exact);
    return;
  }

  console.log(`❌ id="${userId}" の完全一致は見つかりませんでした。部分一致を検索します…\n`);

  // 部分一致（id, username, displayName, providerId）
  const matches = await prisma.user.findMany({
    where: {
      OR: [
        { id: { contains: userId } },
        { username: { contains: userId } },
        { displayName: { contains: userId } },
        { providerId: { contains: userId } },
      ],
    },
    include: { bankroll: true },
    take: 20,
  });

  if (matches.length === 0) {
    console.log('  ⇒ 部分一致でも見つかりませんでした');
    return;
  }

  console.log(`  ${matches.length}件ヒット:\n`);
  for (const m of matches) {
    console.log('--------------------------------------------------------');
    printUser(m);
    console.log('');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
