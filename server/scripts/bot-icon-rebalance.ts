/// <reference types="node" />
/**
 * Botのアイコンをリバランスするスクリプト
 * - 約20%のBotをanonymous.svg（avatarUrl = null）に設定
 * - 残り80%を70種のプリセットアイコンに均等分散
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-icon-rebalance.ts --prod          # プレビュー
 *   cd server && npx tsx scripts/bot-icon-rebalance.ts --prod --apply  # 適用
 */
import { PrismaClient } from '@prisma/client';

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

const ANONYMOUS_RATIO = 0.2; // 20%をanonymous（avatarUrl = null）

async function main() {
  const bots = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true, username: true, displayName: true, avatarUrl: true },
  });

  console.log(`=== Bot総数: ${bots.length} ===\n`);

  // シャッフル
  const shuffled = [...bots].sort(() => Math.random() - 0.5);

  const anonymousCount = Math.round(bots.length * ANONYMOUS_RATIO);
  const presetCount = bots.length - anonymousCount;

  console.log(`anonymous.svg: ${anonymousCount}体 (${Math.round(ANONYMOUS_RATIO * 100)}%)`);
  console.log(`プリセットアイコン: ${presetCount}体 → 70種に均等分散\n`);

  // 割り当て計画
  type Assignment = { id: string; name: string; oldUrl: string | null; newUrl: string | null };
  const assignments: Assignment[] = [];

  // 前半をanonymous（null）に
  for (let i = 0; i < anonymousCount; i++) {
    const bot = shuffled[i];
    assignments.push({
      id: bot.id,
      name: bot.displayName || bot.username,
      oldUrl: bot.avatarUrl,
      newUrl: null,
    });
  }

  // 後半を70種アイコンに均等分散（ラウンドロビン）
  for (let i = 0; i < presetCount; i++) {
    const bot = shuffled[anonymousCount + i];
    const iconNum = (i % 70) + 1;
    const newUrl = `/images/icons/icon_${String(iconNum).padStart(3, '0')}.png`;
    assignments.push({
      id: bot.id,
      name: bot.displayName || bot.username,
      oldUrl: bot.avatarUrl,
      newUrl,
    });
  }

  // プレビュー: anonymous割り当て
  const toAnonymous = assignments.filter(a => a.newUrl === null);
  console.log(`--- anonymous.svg に設定 (${toAnonymous.length}体) ---`);
  for (const a of toAnonymous) {
    const from = a.oldUrl ? a.oldUrl.replace('/images/icons/', '') : '(なし)';
    console.log(`  ${a.name.padEnd(20)} ${from} → anonymous`);
  }

  // プレビュー: アイコン分布
  const iconCounts = new Map<number, number>();
  const toPreset = assignments.filter(a => a.newUrl !== null);
  for (const a of toPreset) {
    const m = a.newUrl!.match(/icon_(\d+)/);
    if (m) {
      const num = parseInt(m[1]);
      iconCounts.set(num, (iconCounts.get(num) || 0) + 1);
    }
  }
  const counts = [...iconCounts.values()];
  const minCount = Math.min(...counts);
  const maxCount = Math.max(...counts);
  console.log(`\n--- プリセットアイコン分布 ---`);
  console.log(`  各アイコン: ${minCount}〜${maxCount}体 (70種)`);

  // 変更が必要なもののみカウント
  const changes = assignments.filter(a => a.oldUrl !== a.newUrl);
  console.log(`\n変更対象: ${changes.length}体 / ${bots.length}体`);

  if (apply) {
    console.log('\n--- 適用中 ---\n');
    for (const a of changes) {
      await prisma.user.update({
        where: { id: a.id },
        data: { avatarUrl: a.newUrl },
      });
      const to = a.newUrl ? a.newUrl.replace('/images/icons/', '') : 'anonymous';
      console.log(`  ✅ ${a.name} → ${to}`);
    }
    console.log(`\n完了！ ${changes.length}体を更新`);
  } else {
    console.log('\n  ※ --apply フラグを付けて実行すると実際にDBを更新します');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
