/// <reference types="node" />
/**
 * 指定Botの7割をanonymousアイコンに設定
 *
 * 実行:
 *   cd server && npx tsx scripts/set-anonymous-batch.ts --prod
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

const TARGET_BOTS = [
  'RyoH07', 'jiro_t88', 'kouhei_m', 'mirei_plo', 'asami_t',
  'kana_s15', 'soma_k13', 'ren_omaha', 'misaki_h', 'issei_k9',
  'mio_pkr5', 'ShugoMura', 'mizuki_s3', 'AmiH07', 'sara_plo',
  'moe_chan3', 'maiko_s11', 'yutaro33', 'kouki_m3',
];

async function main() {
  // シャッフルして7割を選択
  const shuffled = [...TARGET_BOTS].sort(() => Math.random() - 0.5);
  const anonymousCount = Math.round(TARGET_BOTS.length * 0.3);
  const toAnonymous = shuffled.slice(0, anonymousCount);
  const toKeep = shuffled.slice(anonymousCount);

  console.log(`対象: ${TARGET_BOTS.length}体 → anonymous: ${toAnonymous.length}体, そのまま: ${toKeep.length}体\n`);

  console.log('--- anonymousに変更 ---');
  for (const name of toAnonymous) {
    const result = await prisma.user.updateMany({
      where: { provider: 'bot', providerId: name },
      data: { avatarUrl: '/images/icons/anonymous.svg' },
    });
    console.log(`  ✅ ${name} → anonymous (${result.count}件)`);
  }

  console.log('\n--- そのまま ---');
  for (const name of toKeep) {
    console.log(`  ${name}`);
  }

  console.log(`\n完了！`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
