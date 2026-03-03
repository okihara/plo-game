/// <reference types="node" />
/**
 * avatarUrl=null のBotに anonymous.svg パスを設定するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/fix-anonymous-bots.ts --prod
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
  const result = await prisma.user.updateMany({
    where: { provider: 'bot', avatarUrl: null },
    data: { avatarUrl: '/images/icons/anonymous.svg' },
  });

  console.log(`✅ ${result.count}体のBotを anonymous.svg に更新しました`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
