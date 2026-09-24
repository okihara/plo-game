/// <reference types="node" />
/**
 * role が PLAYER 以外（ADMIN / GUEST）のユーザーを一覧するスクリプト。
 * コーチング用のプライベートルーム一覧 API は ADMIN role で認可されるため、
 * 「コーチング権限を持つユーザー」の棚卸しに使う。
 *
 * 実行:
 *   cd server && npx tsx scripts/list-privileged-users.ts          # ローカルDB
 *   cd server && npx tsx scripts/list-privileged-users.ts --prod   # 本番DB
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const isProd = process.argv.includes('--prod');
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  console.log(isProd ? '🔗 本番DB' : '🔗 ローカルDB');
  const users = await prisma.user.findMany({
    where: { role: { not: 'PLAYER' } },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      provider: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: [{ role: 'asc' }, { username: 'asc' }],
  });

  console.log(`該当ユーザー: ${users.length}件\n`);
  for (const u of users) {
    console.log(
      [
        u.role.padEnd(6),
        u.username.padEnd(20),
        (u.displayName ?? '—').padEnd(16),
        u.provider.padEnd(8),
        `last=${u.lastLoginAt?.toISOString().slice(0, 10) ?? '—'}`,
        `id=${u.id}`,
      ].join('  ')
    );
  }

  const counts = await prisma.user.groupBy({ by: ['role'], _count: { _all: true } });
  console.log('\n--- role 別ユーザー数 ---');
  for (const c of counts) console.log(`${c.role.padEnd(6)} ${c._count._all}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
