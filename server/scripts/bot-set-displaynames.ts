/// <reference types="node" />
/**
 * displayNameなしのBotの約70%にdisplayNameを設定するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-set-displaynames.ts --prod          # プレビュー
 *   cd server && npx tsx scripts/bot-set-displaynames.ts --prod --apply  # 適用
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

/** usernameから自然なdisplayNameを生成 */
function generateDisplayName(username: string): string {
  const r = Math.random();

  // 15%: 日本語名
  if (r < 0.15) {
    const jpNames = [
      'たくや', 'さくら', 'ゆうき', 'はると', 'みれい',
      'あおい', 'れん', 'まいこ', 'ひなた', 'りく',
      'さよ', 'ゆたろう', 'かな', 'だいと', 'もえ',
      'そら', 'るみ', 'つばさ', 'ゆい', 'けんた',
      'あさみ', 'しゅうご', 'なお', 'みさき', 'たくま',
      'りな', 'ひでき', 'かえで', 'じゅん', 'わたる',
      'えみこ', 'りょう', 'ましろ', 'こうき', 'あゆみ',
      'そうた', 'ゆな', 'せりな', 'てつ', 'かずは',
      'ふみと', 'りお', 'いっせい', 'あかね', 'たいち',
      'すみか', 'れんと', 'もえか', 'がく', 'さえこ',
    ];
    return jpNames[Math.floor(Math.random() * jpNames.length)];
  }

  // 40%: usernameそのまま
  if (r < 0.55) {
    return username;
  }

  // 45%: usernameを少し変える
  const variations: (() => string)[] = [
    // アンダースコアを消す
    () => username.replace(/_/g, ''),
    // 数字を消す
    () => username.replace(/\d+/g, '') || username,
    // 末尾の数字を消す
    () => username.replace(/\d+$/, '') || username,
    // 先頭を大文字に
    () => username.charAt(0).toUpperCase() + username.slice(1),
    // 全部小文字
    () => username.toLowerCase(),
    // _pkr, _plo, _omaha 等のサフィックスを消す
    () => username.replace(/[_](pkr|plo|omaha|ace|chan)\d*$/, '') || username,
    // 数字部分を変える
    () => {
      const base = username.replace(/\d+/g, '');
      if (base === username) return username;
      const newNum = Math.floor(Math.random() * 99) + 1;
      return base + newNum;
    },
  ];

  const variant = variations[Math.floor(Math.random() * variations.length)]();
  // 変化がなければそのまま返す
  return variant.length >= 2 ? variant : username;
}

async function main() {
  const bots = await prisma.user.findMany({
    where: { provider: 'bot', displayName: null },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });

  console.log(`=== displayNameなしのBot: ${bots.length}体 ===\n`);

  // 70%にdisplayNameを設定
  const shuffled = [...bots].sort(() => Math.random() - 0.5);
  const targetCount = Math.round(bots.length * 0.7);
  const toUpdate = shuffled.slice(0, targetCount);
  const toSkip = shuffled.slice(targetCount);

  // displayName生成（重複チェック）
  const usedNames = new Set<string>();
  const assignments: { id: string; username: string; displayName: string }[] = [];

  for (const bot of toUpdate) {
    let name = generateDisplayName(bot.username);
    // 重複回避
    let attempts = 0;
    while (usedNames.has(name) && attempts < 10) {
      name = generateDisplayName(bot.username);
      attempts++;
    }
    usedNames.add(name);
    assignments.push({ id: bot.id, username: bot.username, displayName: name });
  }

  console.log(`設定対象: ${assignments.length}体 / ${bots.length}体`);
  console.log(`スキップ（マスク表示のまま）: ${toSkip.length}体\n`);

  // カテゴリ別に表示
  const same = assignments.filter(a => a.username === a.displayName);
  const modified = assignments.filter(a => a.username !== a.displayName && !/^[\u3000-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(a.displayName));
  const japanese = assignments.filter(a => /^[\u3000-\u9fff\u3040-\u309f\u30a0-\u30ff]/.test(a.displayName));

  console.log(`--- usernameそのまま: ${same.length}体 ---`);
  for (const a of same) {
    console.log(`  ${a.username} → ${a.displayName}`);
  }

  console.log(`\n--- 少し変更: ${modified.length}体 ---`);
  for (const a of modified) {
    console.log(`  ${a.username} → ${a.displayName}`);
  }

  console.log(`\n--- 日本語名: ${japanese.length}体 ---`);
  for (const a of japanese) {
    console.log(`  ${a.username} → ${a.displayName}`);
  }

  console.log(`\n--- スキップ（マスク表示のまま）: ${toSkip.length}体 ---`);
  for (const s of toSkip.sort((a, b) => a.username.localeCompare(b.username))) {
    console.log(`  ${s.username}`);
  }

  if (apply) {
    console.log('\n--- 適用中 ---\n');
    for (const a of assignments) {
      await prisma.user.update({
        where: { id: a.id },
        data: { displayName: a.displayName, nameMasked: false },
      });
    }
    console.log(`✅ ${assignments.length}体のdisplayNameを設定しました`);
  } else {
    console.log('\n  ※ --apply フラグを付けて実行すると実際にDBを更新します');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
