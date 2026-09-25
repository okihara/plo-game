/// <reference types="node" />
/**
 * 【ローカル専用】進行中シーズンの RP ランキング表示を確認するためのテストデータを投入する。
 *
 * - CURRENT_SEASON 期間内に完了した「[DEV] シーズンRPテスト」トナメを複数作成し、
 *   ダミーユーザー（rpdev_XX）と既存の非Botユーザーを参加させる
 * - --me=<username> で指定したユーザーは TOP30 圏外（30位台後半）に来るよう弱めに設定し、
 *   「自分の順位＋前後」表示を確認できるようにする
 *
 * 実行:
 *   cd server && npx tsx scripts/seed-season-rp-dev.ts --me=okkichan3   # 投入（既存のテストデータは作り直す）
 *   cd server && npx tsx scripts/seed-season-rp-dev.ts --clean          # テストデータ削除
 *
 * 接続先が localhost 以外なら中止する（本番DBへの誤投入防止）。
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env'), quiet: true });

const TOURNAMENT_PREFIX = '[DEV] シーズンRPテスト';
const DUMMY_PREFIX = 'rpdev_';
const DUMMY_COUNT = 80;
const TOURNAMENT_COUNT = 20;
const BUY_IN = 3000;

const dbUrl = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('ERROR: DATABASE_URL が localhost ではありません。このスクリプトはローカル専用です。');
  process.exit(1);
}

const clean = process.argv.includes('--clean');
const meArg = process.argv.find((a) => a.startsWith('--me='))?.slice('--me='.length);

const prisma = new PrismaClient();

/** 再現性のある乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function removeSeedData() {
  const { count } = await prisma.tournament.deleteMany({ where: { name: { startsWith: TOURNAMENT_PREFIX } } });
  console.log(`🗑  テストトナメを ${count} 件削除（結果は Cascade で削除）`);
}

async function ensureDummyUsers(): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 1; i <= DUMMY_COUNT; i++) {
    const username = `${DUMMY_PREFIX}${String(i).padStart(2, '0')}`;
    const user = await prisma.user.upsert({
      where: { username },
      update: {},
      create: { email: `${username}@dev.local`, username, provider: 'dev', providerId: username },
    });
    ids.push(user.id);
  }
  return ids;
}

async function main() {
  await removeSeedData();
  if (clean) return;

  const dummyIds = await ensureDummyUsers();
  const me = meArg ? await prisma.user.findUnique({ where: { username: meArg } }) : null;
  if (meArg && !me) {
    console.error(`ERROR: --me=${meArg} のユーザーが見つかりません`);
    process.exit(1);
  }

  // skill が高いほど上位に来やすい。自分は圏外（30位台後半）に来るよう低めに固定
  const rand = rng(20260925);
  const players = dummyIds.map((id, i) => ({ id, skill: DUMMY_COUNT - i }));
  if (me) players.push({ id: me.id, skill: 50 });

  const start = CURRENT_SEASON.start.getTime();
  const end = Math.min(Date.now(), CURRENT_SEASON.end.getTime());
  const step = (end - start) / (TOURNAMENT_COUNT + 1);

  for (let t = 0; t < TOURNAMENT_COUNT; t++) {
    const order = players
      .map((p) => ({ ...p, score: p.skill + rand() * 80 }))
      .sort((a, b) => b.score - a.score);
    const completedAt = new Date(start + step * (t + 1));

    await prisma.tournament.create({
      data: {
        name: `${TOURNAMENT_PREFIX} #${t + 1}`,
        status: 'COMPLETED',
        buyIn: BUY_IN,
        startingChips: 30000,
        blindSchedule: [],
        prizePool: BUY_IN * order.length,
        startedAt: new Date(completedAt.getTime() - 2 * 60 * 60 * 1000),
        completedAt,
        results: {
          create: order.map((p, i) => ({ userId: p.id, position: i + 1 })),
        },
      },
    });
  }

  console.log(`✅ ${CURRENT_SEASON.name} にテストトナメ ${TOURNAMENT_COUNT} 件（各 ${players.length} 人）を投入しました`);
  if (me) console.log(`   自分: ${me.username} (${me.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
