/// <reference types="node" />
/**
 * displayNameなしBotの追加設定（61% → 80%）
 * 70体中34体にdisplayNameを設定。約半分を日本語ニックネーム（usernameから派生）。
 *
 * 実行:
 *   cd server && npx tsx scripts/bot-set-displaynames-2.ts --prod          # プレビュー
 *   cd server && npx tsx scripts/bot-set-displaynames-2.ts --prod --apply  # 適用
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

// username → displayName の固定マッピング（34体）
// 日本語名はネットあだ名風に崩す（省略・ん付け・っち・りん・長音・リピート・促音等）
const assignments: Record<string, string> = {
  // --- 日本語ニックネーム（17体）---
  'akane_t2':   'あかねん',    // ん付け
  'AmiH07':     'あーみ',      // 長音化
  'aoi1208':    'あおい',      // シンプル変換
  'arisa_t3':   'ありっさ',    // 促音挿入
  'DaigoN':     'ダイゴ',      // カタカナ化
  'erina_m6':   'えりりん',    // りん付け
  'hana_plo':   'はなっち',    // っち付け
  'hina2525':   'ひなひな',    // リピート
  'iori_k9':    'イオリ',      // カタカナ化
  'kaede0808':  'かえでぃ',    // 小文字ぃ
  'Kaito_R':    'カイト',      // カタカナ化
  'kotoha_m':   'ことは',      // シンプル変換
  'MaoT14':     'まおまお',    // リピート
  'nagi_plo':   'なぎー',      // 長音化
  'tsumugi_s':  'つむ',        // 省略
  'wakana_3':   'わかなん',    // ん付け
  'yume_pkr':   'ゆめっち',    // っち付け

  // --- 英数字ニックネーム（17体）---
  'ayumi_n':    'ayumi',
  'daiki_s4':   'daiki',
  'DaichiM':    'Daichi',
  'hajime_k':   'hajime',
  'hideki_n':   'hideki',
  'KosukeH':    'Kosuke',
  'KotaroS':    'Kotaro',
  'MasatoH':    'Masato',
  'MizuhoT':    'Mizuho',
  'ShinyaT':    'Shinya',
  'TaigaN':     'Taiga',
  'TomoyaS':    'Tomoya',
  'YukiH33':    'Yuki',
  'YumaS':      'Yuma',
  'YutoK07':    'Yuto',
  'serina_h':   'serina',
  'teppei_n':   'teppei',
};

async function main() {
  // 既存のdisplayName取得（重複チェック）
  const existing = await prisma.user.findMany({
    where: { provider: 'bot', displayName: { not: null } },
    select: { displayName: true },
  });
  const usedNames = new Set(existing.map(u => u.displayName));

  // 重複チェック
  const duplicates = Object.entries(assignments).filter(([, name]) => usedNames.has(name));
  if (duplicates.length > 0) {
    console.error('⚠️  既存displayNameと重複:');
    for (const [username, name] of duplicates) {
      console.error(`  ${username} → ${name}`);
    }
    console.error('重複を解消してから再実行してください');
    return;
  }

  // 対象Bot取得
  const bots = await prisma.user.findMany({
    where: { provider: 'bot', displayName: null },
    select: { id: true, username: true },
  });
  const botMap = new Map(bots.map(b => [b.username, b.id]));

  // マッピング検証
  const notFound = Object.keys(assignments).filter(u => !botMap.has(u));
  if (notFound.length > 0) {
    console.error('⚠️  DBに見つからないusername:');
    notFound.forEach(u => console.error(`  ${u}`));
    console.error('確認してください');
    return;
  }

  // 表示
  const entries = Object.entries(assignments);
  const jpEntries = entries.filter(([, name]) => /[^\x00-\x7F]/.test(name));
  const asciiEntries = entries.filter(([, name]) => !/[^\x00-\x7F]/.test(name));

  console.log(`設定対象: ${entries.length}体`);
  console.log(`  日本語: ${jpEntries.length}体`);
  console.log(`  英数字: ${asciiEntries.length}体`);
  console.log(`残りマスク: ${bots.length - entries.length}体\n`);

  console.log('--- 日本語ニックネーム ---');
  for (const [username, name] of jpEntries) {
    console.log(`  ${username} → ${name}`);
  }

  console.log('\n--- 英数字ニックネーム ---');
  for (const [username, name] of asciiEntries) {
    console.log(`  ${username} → ${name}`);
  }

  const totalBots = 180;
  const afterCount = 110 + entries.length;
  console.log(`\n📊 適用後: ${afterCount}/${totalBots} = ${(afterCount / totalBots * 100).toFixed(1)}%`);

  if (apply) {
    console.log('\n--- 適用中 ---\n');
    for (const [username, displayName] of entries) {
      const id = botMap.get(username)!;
      await prisma.user.update({
        where: { id },
        data: { displayName, nameMasked: false },
      });
    }
    console.log(`✅ ${entries.length}体のdisplayNameを設定しました`);
  } else {
    console.log('\n※ --apply フラグを付けて実行すると実際にDBを更新します');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
