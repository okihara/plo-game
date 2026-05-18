/// <reference types="node" />
/**
 * 指定 username のユーザーに ADMIN role を付与するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/set-admin-roles.ts          # ローカルDB (dry-run 既定)
 *   cd server && npx tsx scripts/set-admin-roles.ts --apply  # ローカルDBに適用
 *   cd server && npx tsx scripts/set-admin-roles.ts --prod --apply  # 本番DBに適用
 */
import { PrismaClient, Role } from '@prisma/client';

const ADMIN_USERNAMES = ['succhan627', 'okkichan3', 'babyplo_'];

const isProd = process.argv.includes('--prod');
const apply = process.argv.includes('--apply');

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
  const users = await prisma.user.findMany({
    where: { username: { in: ADMIN_USERNAMES } },
    select: { id: true, username: true, role: true },
  });

  const found = new Set(users.map((u) => u.username));
  const missing = ADMIN_USERNAMES.filter((u) => !found.has(u));

  console.log('=== 対象ユーザー ===');
  for (const u of users) {
    const willChange = u.role !== Role.ADMIN;
    console.log(`  ${u.username}: role=${u.role}${willChange ? ' → ADMIN' : ' (変更なし)'}`);
  }
  if (missing.length > 0) {
    console.log('\n  ⚠️  未登録のユーザー:');
    for (const m of missing) console.log(`    ${m}`);
  }

  const targets = users.filter((u) => u.role !== Role.ADMIN);
  if (targets.length === 0) {
    console.log('\n全員すでに ADMIN です。');
    return;
  }

  if (!apply) {
    console.log('\n※ --apply フラグを付けて実行すると実際にDBを更新します');
    return;
  }

  console.log('\n--- 適用中 ---');
  const result = await prisma.user.updateMany({
    where: { id: { in: targets.map((u) => u.id) } },
    data: { role: Role.ADMIN },
  });
  console.log(`✅ ${result.count}件を ADMIN に更新しました`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
