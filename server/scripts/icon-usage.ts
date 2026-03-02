/// <reference types="node" />
/**
 * アイコン使用状況を表示するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/icon-usage.ts          # ローカルDB
 *   cd server && npx tsx scripts/icon-usage.ts --prod   # 本番DB
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
  // 全ユーザーの avatarUrl と useTwitterAvatar を取得
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      twitterAvatarUrl: true,
      useTwitterAvatar: true,
    },
  });

  console.log(`=== ユーザー総数: ${users.length} ===\n`);

  // --- カテゴリ別集計 ---
  let twitterAvatarUsers = 0;
  let presetAvatarUsers = 0;
  let noAvatarUsers = 0;

  // プリセットアイコン別カウント (icon_001 ~ icon_070)
  const presetCounts = new Map<string, { count: number; users: string[] }>();

  for (const user of users) {
    if (user.useTwitterAvatar) {
      twitterAvatarUsers++;
      continue;
    }

    if (!user.avatarUrl) {
      noAvatarUsers++;
      continue;
    }

    // プリセットアイコンかどうか判定
    const presetMatch = user.avatarUrl.match(/\/images\/icons\/icon_(\d+)\.png$/);
    if (presetMatch) {
      presetAvatarUsers++;
      const iconKey = `icon_${presetMatch[1]}`;
      const entry = presetCounts.get(iconKey) || { count: 0, users: [] };
      entry.count++;
      const name = user.displayName || user.username;
      if (entry.users.length < 5) entry.users.push(name);
      presetCounts.set(iconKey, entry);
    } else {
      // プリセットでもTwitterでもないURL
      twitterAvatarUsers++; // Twitter直URLなどの可能性
    }
  }

  console.log('--- カテゴリ別 ---');
  console.log(`  Twitterアバター使用: ${twitterAvatarUsers}人`);
  console.log(`  プリセットアイコン使用: ${presetAvatarUsers}人`);
  console.log(`  未設定: ${noAvatarUsers}人`);
  console.log('');

  // --- プリセットアイコン使用状況 ---
  console.log('=== プリセットアイコン使用状況 (icon_001 ~ icon_070) ===\n');

  const usedIcons: { key: string; count: number; users: string[] }[] = [];
  const unusedIcons: string[] = [];

  for (let i = 1; i <= 70; i++) {
    const key = `icon_${String(i).padStart(3, '0')}`;
    const entry = presetCounts.get(key);
    if (entry && entry.count > 0) {
      usedIcons.push({ key, count: entry.count, users: entry.users });
    } else {
      unusedIcons.push(key);
    }
  }

  // 使用数の多い順にソート
  usedIcons.sort((a, b) => b.count - a.count);

  console.log('--- 使用中のアイコン ---');
  for (const icon of usedIcons) {
    const userList = icon.users.join(', ') + (icon.count > 5 ? ', ...' : '');
    console.log(`  ${icon.key}: ${icon.count}人  (${userList})`);
  }
  console.log(`\n  使用中: ${usedIcons.length}種類`);

  console.log('');
  console.log('--- 未使用のアイコン (0人) ---');
  // 10個ずつ改行して表示
  for (let i = 0; i < unusedIcons.length; i += 10) {
    const chunk = unusedIcons.slice(i, i + 10);
    console.log(`  ${chunk.join(', ')}`);
  }
  console.log(`\n  未使用: ${unusedIcons.length}種類`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
