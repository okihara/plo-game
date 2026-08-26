/// <reference types="node" />
/**
 * displayName / username の部分一致でユーザーを探し、各ユーザーの優勝(position=1)を一覧する。
 * 同名別アカウントや改名によって優勝回数を取りこぼしていないかの確認用。
 *
 *   cd server && npx tsx scripts/check-wins-by-name.ts --prod --name SAKAKI
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const nIdx = process.argv.indexOf('--name');
const name = nIdx >= 0 ? process.argv[nIdx + 1] : undefined;

if (!name) {
  console.error('ERROR: --name <文字列> を指定してください');
  process.exit(1);
}
if (isProd && !process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { displayName: { contains: name, mode: 'insensitive' } },
        { username: { contains: name, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, displayName: true, createdAt: true },
  });

  for (const u of users) {
    const results = await prisma.tournamentResult.findMany({
      where: { userId: u.id },
      include: { tournament: { select: { id: true, name: true, completedAt: true, status: true } } },
      orderBy: { tournament: { completedAt: 'asc' } },
    });
    const wins = results.filter((r) => r.position === 1);
    console.log(`--- ${u.displayName} (@${u.username}) id=${u.id} created=${u.createdAt.toISOString()}`);
    console.log(`    エントリー数=${results.length} 優勝=${wins.length}`);
    for (const w of wins) {
      console.log(`    🏆 ${w.tournament.completedAt?.toISOString() ?? '-'} ${w.tournament.name} [${w.tournament.status}] (${w.tournament.id})`);
    }
    const top3 = results.filter((r) => r.position !== null && r.position <= 3 && r.position !== 1);
    for (const r of top3) {
      console.log(`    ${r.position}位 ${r.tournament.completedAt?.toISOString() ?? '-'} ${r.tournament.name}`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
