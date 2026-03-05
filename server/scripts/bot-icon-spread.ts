/// <reference types="node" />
/**
 * Botのアイコン使用状況を表示し、未使用アイコンへの再割り当てSQLを生成するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-icon-spread.ts          # ローカルDB
 *   cd server && npx tsx scripts/bot-icon-spread.ts --prod   # 本番DB
 *   cd server && npx tsx scripts/bot-icon-spread.ts --prod --apply  # 本番DBに適用
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

async function main() {
  // 全ユーザーを取得（Bot/人間を区別）
  const allUsers = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      useTwitterAvatar: true,
      provider: true,
    },
  });

  const bots = allUsers.filter(u => u.provider === 'bot');
  const humans = allUsers.filter(u => u.provider !== 'bot');

  console.log(`=== ユーザー総数: ${allUsers.length} (人間: ${humans.length}, Bot: ${bots.length}) ===\n`);

  // --- 人間が使っているプリセットアイコンを集計 ---
  const humanPresetCounts = new Map<string, number>();
  for (const user of humans) {
    if (user.useTwitterAvatar || !user.avatarUrl) continue;
    const m = user.avatarUrl.match(/\/images\/icons\/icon_(\d+)\.png$/);
    if (m) {
      const key = `icon_${m[1]}`;
      humanPresetCounts.set(key, (humanPresetCounts.get(key) || 0) + 1);
    }
  }

  // --- Botのアイコン分布 ---
  const botIconCounts = new Map<string, { count: number; names: string[] }>();
  const botsWithNoPreset: typeof bots = [];

  for (const bot of bots) {
    const m = bot.avatarUrl?.match(/\/images\/icons\/icon_(\d+)\.png$/);
    if (m) {
      const key = `icon_${m[1]}`;
      const entry = botIconCounts.get(key) || { count: 0, names: [] };
      entry.count++;
      entry.names.push(bot.displayName || bot.username);
      botIconCounts.set(key, entry);
    } else {
      botsWithNoPreset.push(bot);
    }
  }

  console.log('=== Botのアイコン分布 ===\n');
  const botEntries = [...botIconCounts.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [key, { count, names }] of botEntries) {
    const humanCount = humanPresetCounts.get(key) || 0;
    const nameList = names.slice(0, 5).join(', ') + (count > 5 ? ', ...' : '');
    console.log(`  ${key}: Bot ${count}体, 人間 ${humanCount}人  (${nameList})`);
  }
  if (botsWithNoPreset.length > 0) {
    console.log(`  (プリセット未設定): ${botsWithNoPreset.length}体`);
  }

  // --- 全70アイコンの使用状況サマリ ---
  console.log('\n=== 全アイコン使用状況 (Bot + 人間) ===\n');

  type IconInfo = { num: number; key: string; botCount: number; humanCount: number; total: number };
  const allIcons: IconInfo[] = [];

  for (let i = 1; i <= 70; i++) {
    const key = `icon_${String(i).padStart(3, '0')}`;
    const botCount = botIconCounts.get(key)?.count || 0;
    const humanCount = humanPresetCounts.get(key) || 0;
    allIcons.push({ num: i, key, botCount, humanCount, total: botCount + humanCount });
  }

  // 使用数0のアイコン
  const unused = allIcons.filter(i => i.total === 0);
  // Botが0のアイコン（人間は使っている）
  const noBotIcon = allIcons.filter(i => i.botCount === 0 && i.humanCount > 0);
  // Botが複数いるアイコン（再割り当て候補）
  const overusedByBot = allIcons.filter(i => i.botCount >= 2);

  console.log(`  完全未使用（Bot 0 + 人間 0）: ${unused.length}種`);
  console.log(`    ${unused.map(i => i.key).join(', ')}`);
  console.log(`  Bot未使用（Bot 0, 人間 1+）: ${noBotIcon.length}種`);
  console.log(`    ${noBotIcon.map(i => `${i.key}(人間${i.humanCount})`).join(', ')}`);
  console.log(`  Bot重複使用（Bot 2+）: ${overusedByBot.length}種`);
  console.log(`    ${overusedByBot.map(i => `${i.key}(Bot${i.botCount})`).join(', ')}`);

  // --- 再割り当て計画を生成 ---
  // 戦略: Bot重複アイコンから余剰Botを、Bot未使用アイコンに再割り当て
  console.log('\n=== 再割り当て計画 ===\n');

  // Bot未使用のアイコン一覧（割り当て先候補）
  const targetIcons = allIcons
    .filter(i => i.botCount === 0)
    .map(i => i.key);

  // 重複Botから移動対象を収集
  type Reassignment = { botId: string; botName: string; from: string; to: string };
  const reassignments: Reassignment[] = [];
  let targetIdx = 0;

  // Botが多い順に処理
  const overused = [...botIconCounts.entries()]
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count);

  for (const [iconKey, { names }] of overused) {
    // 1体だけ残して残りを再割り当て
    const botsOnIcon = bots.filter(b => {
      const m = b.avatarUrl?.match(/\/images\/icons\/icon_(\d+)\.png$/);
      return m && `icon_${m[1]}` === iconKey;
    });

    for (let j = 1; j < botsOnIcon.length; j++) {
      if (targetIdx >= targetIcons.length) break;
      const bot = botsOnIcon[j];
      reassignments.push({
        botId: bot.id,
        botName: bot.displayName || bot.username,
        from: iconKey,
        to: targetIcons[targetIdx],
      });
      targetIdx++;
    }
  }

  // プリセット未設定Botも割り当て
  for (const bot of botsWithNoPreset) {
    if (targetIdx >= targetIcons.length) break;
    reassignments.push({
      botId: bot.id,
      botName: bot.displayName || bot.username,
      from: '(なし)',
      to: targetIcons[targetIdx],
    });
    targetIdx++;
  }

  if (reassignments.length === 0) {
    console.log('  再割り当て不要（Botは既に分散されています）');
  } else {
    console.log(`  ${reassignments.length}体のBotを再割り当て:\n`);
    for (const r of reassignments) {
      const toNum = r.to.replace('icon_', '');
      const toUrl = `/images/icons/icon_${toNum}.png`;
      console.log(`  ${r.botName}: ${r.from} → ${r.to}`);
    }

    if (apply) {
      console.log('\n--- 適用中 ---\n');
      for (const r of reassignments) {
        const toNum = r.to.replace('icon_', '');
        const toUrl = `/images/icons/icon_${toNum}.png`;
        await prisma.user.update({
          where: { id: r.botId },
          data: { avatarUrl: toUrl },
        });
        console.log(`  ✅ ${r.botName}: → ${toUrl}`);
      }
      console.log('\n完了！');
    } else {
      console.log('\n  ※ --apply フラグを付けて実行すると実際にDBを更新します');
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
