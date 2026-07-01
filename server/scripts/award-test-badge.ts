/**
 * テスト用: 指定ユーザーに任意のバッジを付与する（動作確認用）。
 *
 * 実行:
 *   cd server && npx tsx scripts/award-test-badge.ts <username> <badgeType>
 *   例) npx tsx scripts/award-test-badge.ts okkichan3 season1_no1
 *
 * --prod を付けると本番DB（.env の DATABASE_PROD_PUBLIC_URL）を対象にする。既定はローカルDB。
 * 同じ (userId, type) が既にあれば付与しない（冪等）。
 */
import { PrismaClient } from '@prisma/client';
import { config as loadDotenv } from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
loadDotenv({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [username, badgeType] = args;

if (!username || !badgeType) {
  console.error('Usage: npx tsx scripts/award-test-badge.ts <username> <badgeType> [--prod]');
  process.exit(1);
}

const prisma = isProd
  ? new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } })
  : new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({
    where: { username },
    select: { id: true, username: true, displayName: true },
  });
  if (!user) {
    console.error(`ユーザーが見つかりません: username=${username} (${isProd ? '本番' : 'ローカル'}DB)`);
    process.exit(1);
  }

  const existing = await prisma.badge.findFirst({
    where: { userId: user.id, type: badgeType },
    select: { id: true },
  });
  if (existing) {
    console.log(`既に付与済み: ${user.username} (${user.displayName ?? '-'}) → ${badgeType}`);
    return;
  }

  await prisma.badge.create({ data: { userId: user.id, type: badgeType } });
  console.log(`付与しました: ${user.username} (${user.displayName ?? '-'}) → ${badgeType} [${isProd ? '本番' : 'ローカル'}DB]`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
