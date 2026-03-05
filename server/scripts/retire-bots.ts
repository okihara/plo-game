/// <reference types="node" />
/**
 * 5000ハンド以上のBotを特定し、BOT_NAMES入れ替えリストを生成するスクリプト
 *
 * 実行:
 *   cd server && npx tsx scripts/retire-bots.ts --prod
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

const BOT_NAMES = [
  'Taku83', 'mii_chan', 'ShotaK', 'risa.p', 'YuHayashi',
  'ken2408', 'NanaM', 'daisk77', 'HaruSun', 'AyakaSaito',
  'ryooo3', 'MizuhoT', 'shun_pkr', 'Sakuraba', 'kojimax',
  'Mei0522', 'TatsuyaN', 'yuna0312', 'Kaito_R', 'momoka55',
  'ReinaK42', 'takuya_s', 'Yamamoto7', 'hina2525', 'KenjiF',
  'Sora_99', 'mayu_plo', 'DaichiM', 'aoi1208', 'RyosukeT',
  'mikimiki3', 'HiroShi', 'natsuki_p', 'YutoK07', 'haruna88',
  'KazukiH', 'rin_chan5', 'TomoyaS', 'asuka111', 'KoharuN',
  'shunsuke', 'MaoT14', 'yuki_ace', 'IkuoW', 'chiho33',
  'RenK', 'aya_poker', 'TakeshiM', 'mana0808', 'YusukeH',
  'karin22', 'ShinyaT', 'miho_pkr', 'DaigoN', 'sakiY05',
  'KotaroS', 'nene777', 'AtsushiK', 'yui_0210', 'MasatoH',
  'hana_plo', 'SoichiroT', 'riho99', 'KengoM', 'akane_55',
  'YumaS', 'shiori12', 'TakeruN', 'mai_chan', 'RyujiK',
  'miku0603', 'HayatoS', 'kanako_p', 'JunpeiT', 'riko2424',
  'NaokiM', 'sae_pkr', 'KosukeH', 'yurina10', 'MakotoS',
  'chihiro7', 'TaigaN', 'ami_0930', 'ShogoK', 'nanami22',
  'RyotaH', 'kyoko_p', 'YoshikiT', 'eri_chan', 'DaisukeN',
  'momo_plo', 'KeisukeS', 'sayaka88', 'AkiraM', 'yuzuki13',
  'ShinjiK', 'rika_ace', 'HikaruN', 'tomomi55', 'GoT08',
];

const MAX_HANDS = 5000;

async function main() {
  // Bot全員の providerId（= botName）とハンド数を取得
  const bots = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: {
      providerId: true,
      username: true,
      statsCache: { select: { handsPlayed: true } },
    },
  });

  // providerId → handsPlayed のマップ
  const handsByName = new Map<string, number>();
  for (const bot of bots) {
    handsByName.set(bot.providerId, bot.statsCache?.handsPlayed ?? 0);
  }

  const retired: { name: string; hands: number }[] = [];
  const kept: { name: string; hands: number }[] = [];

  for (const name of BOT_NAMES) {
    const hands = handsByName.get(name) ?? 0;
    if (hands >= MAX_HANDS) {
      retired.push({ name, hands });
    } else {
      kept.push({ name, hands });
    }
  }

  retired.sort((a, b) => b.hands - a.hands);
  kept.sort((a, b) => b.hands - a.hands);

  console.log(`=== 引退対象（${MAX_HANDS}ハンド以上）: ${retired.length}体 ===\n`);
  for (const r of retired) {
    console.log(`  ${r.name.padEnd(20)} ${String(r.hands).padStart(6)} hands`);
  }

  console.log(`\n=== 継続（${MAX_HANDS}ハンド未満）: ${kept.length}体 ===\n`);
  for (const k of kept) {
    console.log(`  ${k.name.padEnd(20)} ${String(k.hands).padStart(6)} hands`);
  }

  console.log(`\n--- 必要な新しい名前: ${retired.length}体 ---`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
