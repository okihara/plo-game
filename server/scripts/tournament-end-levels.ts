/// <reference types="node" />
/**
 * 完了したトーナメントについて、エントリー数と優勝が決まった時の
 * ブラインドレベルを集計する。
 *
 *   cd server && npx tsx scripts/tournament-end-levels.ts --prod
 *   cd server && npx tsx scripts/tournament-end-levels.ts --prod --limit 50
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : 40;

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が .env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

type BlindLevel = {
  level: number;
  smallBlind: number;
  bigBlind: number;
  ante?: number;
  durationMinutes: number;
};

function resolveEndLevel(schedule: BlindLevel[], elapsedMinutes: number): {
  level: number;
  bb: number;
  cumulative: number;
} {
  let cumulative = 0;
  for (const lv of schedule) {
    cumulative += lv.durationMinutes;
    if (elapsedMinutes <= cumulative) {
      return { level: lv.level, bb: lv.bigBlind, cumulative };
    }
  }
  const last = schedule[schedule.length - 1];
  return { level: last.level, bb: last.bigBlind, cumulative };
}

async function main() {
  const tournaments = await prisma.tournament.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { not: null },
    },
    orderBy: { completedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      startingChips: true,
      blindSchedule: true,
      scheduledStartTime: true,
      startedAt: true,
      completedAt: true,
      registrations: { select: { reentryCount: true } },
    },
  });

  console.log(`完了済みトーナメント（直近 ${tournaments.length} 件、新しい順）\n`);
  console.log(
    [
      '完了日時(JST)',
      '名前',
      '人数',
      'エントリー',
      '所要(分)',
      '終了Lv',
      '終了BB',
      '1Lv(分)',
    ].join('\t'),
  );

  for (const t of tournaments) {
    const schedule = t.blindSchedule as unknown as BlindLevel[];
    if (!Array.isArray(schedule) || schedule.length === 0) continue;

    const players = t.registrations.length;
    const reentries = t.registrations.reduce((s, r) => s + (r.reentryCount ?? 0), 0);
    const entries = players + reentries;

    const startedAt = (t.startedAt ?? t.scheduledStartTime) as Date | null;
    const completedAt = t.completedAt as Date;
    if (!startedAt) continue;
    const startNote = t.startedAt ? '' : '*'; // * = scheduledStartTime fallback
    const elapsedMs = completedAt.getTime() - startedAt.getTime();
    const elapsedMin = elapsedMs / 60_000;

    const { level, bb } = resolveEndLevel(schedule, elapsedMin);
    const lvDuration = schedule[0]?.durationMinutes ?? 0;

    const completedJst = new Date(completedAt.getTime() + 9 * 3600 * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace(/\..+/, '');

    console.log(
      [
        completedJst,
        t.name,
        players,
        entries,
        elapsedMin.toFixed(1) + startNote,
        `Lv${level}`,
        bb.toLocaleString(),
        lvDuration,
      ].join('\t'),
    );
  }
  console.log('\n* = startedAt 未記録のため scheduledStartTime を起点に推定');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
