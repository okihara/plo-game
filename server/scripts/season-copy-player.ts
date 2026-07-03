/// <reference types="node" />
/**
 * ローカルのSeasonSnapshot内の個人記録(players)を、本番ユーザーの集計結果から
 * ローカルの同名ユーザーへコピーする（ローカルで個人データセクションをテストする用）。
 *
 * players は userId キーだが、本番とローカルで同名ユーザーでも userId が異なるため、
 * 本番ユーザーの記録をローカルユーザーの userId に付け替えて差し込む。
 *
 *   cd server && npx tsx scripts/season-copy-player.ts okkichan3
 *
 * 前提: 先に `npx tsx scripts/generate-season-snapshot.ts --from-prod` で
 *       本番データ由来のローカルスナップショットを生成しておくこと。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const NAME = process.argv[2] || 'okkichan3';

if (!process.env.DATABASE_PROD_PUBLIC_URL) {
  console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に未設定です');
  process.exit(1);
}

const prodPrisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } });
const localPrisma = new PrismaClient();

function findUser(client: PrismaClient, name: string) {
  return client.user.findFirst({
    where: { OR: [{ username: name }, { displayName: name }] },
    select: { id: true, username: true, displayName: true },
  });
}

async function main() {
  const [prodU, localU] = await Promise.all([findUser(prodPrisma, NAME), findUser(localPrisma, NAME)]);
  if (!prodU) {
    console.error(`本番に "${NAME}" が見つかりません`);
    process.exit(1);
  }
  if (!localU) {
    console.error(`ローカルに "${NAME}" が見つかりません（先にローカルでログインして作成してください）`);
    process.exit(1);
  }
  console.log(`本番 ${prodU.id} (${prodU.displayName || prodU.username}) → ローカル ${localU.id}`);

  const row = await localPrisma.seasonSnapshot.findUnique({ where: { seasonName: CURRENT_SEASON.name } });
  if (!row) {
    console.error('ローカルにSeasonSnapshotがありません。先に generate-season-snapshot.ts --from-prod を実行してください');
    process.exit(1);
  }

  const data = row.data as unknown as { players?: Record<string, { userId: string; awardRanks?: unknown[] }> };
  const rec = data.players?.[prodU.id];
  if (!data.players || !rec) {
    console.error(`スナップショットに本番 "${NAME}" の記録がありません（シーズン中の参加なし？）`);
    process.exit(1);
  }

  data.players[localU.id] = { ...rec, userId: localU.id };

  await localPrisma.seasonSnapshot.update({
    where: { seasonName: CURRENT_SEASON.name },
    data: { data: data as unknown as object },
  });

  const r = rec as Record<string, unknown>;
  console.log(`\nローカルの "${NAME}"(${localU.id}) に本番の個人データを差し込みました:`);
  console.log(`  RP順位: ${r.rpRank ?? '-'} / RP: ${r.totalRp} / 出場: ${r.tournaments} / 優勝: ${r.wins} / VPIP: ${(r.vpip as number | null)?.toFixed?.(1) ?? '-'}`);
  console.log(`  受賞順位: ${rec.awardRanks?.length ?? 0}件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prodPrisma.$disconnect();
    await localPrisma.$disconnect();
  });
