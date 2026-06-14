/// <reference types="node" />
/**
 * 賞金ベースの RP（ランクポイント）ルールで本番DBを集計し、通算ランキングをテキスト出力する。
 *
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --top=50
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --image=/tmp/rp.png
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --tsv
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --diff   # 最新トナメ前後の順位差分をJSONで出力
 *
 * 付与ルール:
 *   - 対象: シーズン期間内（SEASON_START 〜 SEASON_END）に completedAt がある完了トナメ
 *   - 総エントリー数 N = results.length + sum(reentries)（Bot含む）
 *   - 賞金プール = Tournament.prizePool（DBに保存された実額）
 *   - 賞金分配 = 現行の PrizeCalculator デフォルトルール（上位15%ペイアウト + PAYOUT_STRUCTURES）を
 *               過去トナメにも一律適用して再算定する（過去の実際の分配は無視）
 *   - RP = ceil(再算定後の賞金額 / 1000)。賞金 0 円なら 0RP
 *   - Bot (User.provider='bot') はランキングから除外（エントリー数には含める）
 *   - 同順位（同時バスト）の扱いはデータ上 position が単純整数なのでそのまま
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import { maskName } from '../src/shared/utils.js';
import { PrizeCalculator } from '../src/modules/tournament/PrizeCalculator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProd = process.argv.includes('--prod');
const topArg = process.argv.find((a) => a.startsWith('--top='))?.split('=')[1];
const TOP = topArg ? Number(topArg) : 30;
const TSV = process.argv.includes('--tsv');
const imageArg = process.argv.find((a) => a.startsWith('--image='))?.split('=')[1];
const DIFF = process.argv.includes('--diff');

// DIFF/TSV/image 出力時は JSON/TSV を汚さないため dotenv ログを抑止
config({ path: join(__dirname, '..', '.env'), quiet: DIFF || TSV || !!imageArg });

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

const SEASON_NAME = 'シーズン１';
const SEASON_LABEL = '2026 1/1 - 6/30';
const SEASON_START = new Date('2026-01-01T00:00:00+09:00');
const SEASON_END = new Date('2026-06-30T23:59:59.999+09:00');

function rpFromAmount(amount: number): number {
  if (amount <= 0) return 0;
  return Math.ceil(amount / 1000);
}

type UserAgg = {
  userId: string;
  name: string;
  provider: string;
  totalRp: number;
  entries: number;
  wins: number;
  itm: number;
  best: number;
  totalPrize: number;
};

type TournamentRow = Awaited<ReturnType<typeof fetchTournaments>>[number];

async function fetchTournaments() {
  return prisma.tournament.findMany({
    where: {
      status: 'COMPLETED',
      completedAt: { gte: SEASON_START, lte: SEASON_END },
    },
    select: {
      id: true,
      name: true,
      completedAt: true,
      prizePool: true,
      results: {
        select: {
          userId: true,
          position: true,
          prize: true,
          reentries: true,
          user: { select: { username: true, displayName: true, provider: true, nameMasked: true } },
        },
      },
    },
  });
}

function aggregate(tournaments: TournamentRow[]): {
  ranking: UserAgg[];
  tournamentsCounted: number;
  tournamentsSkipped: number;
} {
  const agg = new Map<string, UserAgg>();
  let tournamentsCounted = 0;
  let tournamentsSkipped = 0;

  for (const t of tournaments) {
    const totalEntries =
      t.results.length + t.results.reduce((s, r) => s + (r.reentries ?? 0), 0);
    if (totalEntries < 2) {
      tournamentsSkipped++;
      continue;
    }
    tournamentsCounted++;

    const prizes = PrizeCalculator.calculate(totalEntries, t.prizePool);
    const amountByPosition = new Map<number, number>(prizes.map((p) => [p.position, p.amount]));
    const itmCount = prizes.length;

    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      const amount = amountByPosition.get(r.position) ?? 0;
      const rp = rpFromAmount(amount);
      const name = r.user.displayName
        ? r.user.displayName
        : (r.user.nameMasked ? maskName(r.user.username) : r.user.username);
      const cur = agg.get(r.userId) ?? {
        userId: r.userId,
        name,
        provider: r.user.provider,
        totalRp: 0,
        entries: 0,
        wins: 0,
        itm: 0,
        best: Infinity,
        totalPrize: 0,
      };
      cur.totalRp += rp;
      cur.entries += 1;
      if (r.position === 1) cur.wins += 1;
      if (r.position <= itmCount) cur.itm += 1;
      if (r.position < cur.best) cur.best = r.position;
      cur.totalPrize += amount;
      agg.set(r.userId, cur);
    }
  }

  const ranking = Array.from(agg.values())
    .filter((u) => u.totalRp > 0)
    .sort((a, b) => b.totalRp - a.totalRp || a.entries - b.entries);

  return { ranking, tournamentsCounted, tournamentsSkipped };
}

async function runDiff(tournaments: TournamentRow[]) {
  const ranked = tournaments
    .filter((t) => t.completedAt)
    .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
  if (ranked.length < 2) {
    console.error('完了トナメが2本未満のため差分を出せません');
    process.exit(1);
  }
  const latest = ranked[0];
  const prevTournaments = tournaments.filter((t) => t.id !== latest.id);

  const current = aggregate(tournaments).ranking;
  const previous = aggregate(prevTournaments).ranking;

  const currentPos = new Map<string, number>();
  current.forEach((u, i) => currentPos.set(u.userId, i + 1));
  const previousPos = new Map<string, number>();
  previous.forEach((u, i) => previousPos.set(u.userId, i + 1));
  const previousRp = new Map<string, number>(previous.map((u) => [u.userId, u.totalRp]));

  const limit = Math.min(TOP, current.length);
  const topEntries = current.slice(0, limit).map((u, i) => {
    const pos = i + 1;
    const prevPos = previousPos.get(u.userId) ?? null;
    const prevRp = previousRp.get(u.userId) ?? 0;
    return {
      position: pos,
      userId: u.userId,
      name: u.name,
      totalRp: u.totalRp,
      rpGained: u.totalRp - prevRp,
      entries: u.entries,
      wins: u.wins,
      itm: u.itm,
      best: u.best === Infinity ? null : u.best,
      previousPosition: prevPos,
      positionDelta: prevPos === null ? null : prevPos - pos, // +でランクアップ
      isNewToTop: prevPos === null || prevPos > limit,
    };
  });

  // 参加者のRP獲得を抽出（順位圏外の人も含めて、最新トナメでRPを獲得した人）
  const latestParticipants = new Set(
    latest.results.filter((r) => r.user.provider !== 'bot').map((r) => r.userId)
  );
  const participantsChange = current
    .filter((u) => latestParticipants.has(u.userId))
    .map((u) => {
      const pos = currentPos.get(u.userId)!;
      const prevPos = previousPos.get(u.userId) ?? null;
      const prevRp = previousRp.get(u.userId) ?? 0;
      return {
        userId: u.userId,
        name: u.name,
        currentPosition: pos,
        previousPosition: prevPos,
        positionDelta: prevPos === null ? null : prevPos - pos,
        totalRp: u.totalRp,
        rpGained: u.totalRp - prevRp,
      };
    })
    .sort((a, b) => b.rpGained - a.rpGained);

  const output = {
    latestTournament: {
      id: latest.id,
      name: latest.name,
      completedAt: latest.completedAt ? latest.completedAt.toISOString() : null,
      entries: latest.results.length,
    },
    totals: {
      currentRankedUsers: current.length,
      previousRankedUsers: previous.length,
    },
    top: topEntries,
    participants: participantsChange,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}

async function main() {
  const tournaments = await fetchTournaments();

  if (DIFF) {
    await runDiff(tournaments);
    return;
  }

  const { ranking, tournamentsCounted, tournamentsSkipped } = aggregate(tournaments);

  if (TSV || imageArg) {
    const limit = Math.min(TOP, ranking.length);
    const today = new Date().toISOString().slice(0, 10);
    const lines: string[] = [];
    lines.push(`#title=BabyPLO トーナメントランキング ${SEASON_NAME}`);
    lines.push(`#subtitle=${SEASON_LABEL} / 完了トナメ ${tournamentsCounted} 本の集計（${today}時点）`);
    lines.push(`#footer=賞金額（上位15%へ再分配）の 1/1000 切り上げで RP 化`);
    ranking.slice(0, limit).forEach((u, i) => {
      lines.push([
        i + 1,
        u.name,
        u.totalRp,
        u.entries,
        u.wins,
        u.itm,
        u.best === Infinity ? '-' : u.best,
      ].join('\t'));
    });

    const payload = lines.join('\n') + '\n';
    if (imageArg) {
      const py = spawn('python3', [join(__dirname, 'render-rp-ranking.py'), imageArg], {
        stdio: ['pipe', 'inherit', 'inherit'],
      });
      py.stdin.write(payload);
      py.stdin.end();
      await new Promise<void>((resolve, reject) => {
        py.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`render exited ${code}`))));
      });
    } else {
      process.stdout.write(payload);
    }
    return;
  }

  console.log(`シーズン: ${SEASON_NAME} (${SEASON_LABEL})`);
  console.log(`完了トナメ数: ${tournamentsCounted}（エントリー数<2 でスキップ: ${tournamentsSkipped}）`);
  console.log(`ランキング対象ユーザー: ${ranking.length} 人\n`);

  console.log('付与人数テーブル（N→paidPlaces, 上位15%）:');
  for (const n of [6, 9, 12, 18, 27, 36, 54, 72, 100, 150, 200, 300, 500]) {
    console.log(`  N=${n.toString().padStart(4)} → ${PrizeCalculator.getDefaultPaidPlaces(n)}`);
  }
  console.log('\nRP例（buyIn=1000 サンプル / 1位・最下位付賞）:');
  const SAMPLE_BUYIN = 1000;
  for (const n of [6, 9, 18, 27, 54, 100, 200]) {
    const pool = SAMPLE_BUYIN * n;
    const prizes = PrizeCalculator.calculate(n, pool);
    if (prizes.length === 0) continue;
    const topAmt = prizes[0].amount;
    const lastAmt = prizes[prizes.length - 1].amount;
    console.log(
      `  N=${n.toString().padStart(4)} (付与${prizes.length}人, pool=${pool}): 1位=${rpFromAmount(topAmt)}RP(${topAmt}) / ${prizes.length}位=${rpFromAmount(lastAmt)}RP(${lastAmt})`
    );
  }
  console.log('');

  const limit = Math.min(TOP, ranking.length);
  console.log(`=== 通算ランキング TOP ${limit} ===`);
  const header = `${'順位'.padStart(4)}  ${'RP'.padStart(6)}  ${'出場'.padStart(4)}  ${'優勝'.padStart(4)}  ${'RP圏'.padStart(4)}  ${'最高'.padStart(4)}  ${'賞金'.padStart(9)}  名前`;
  console.log(header);
  console.log('-'.repeat(header.length));
  ranking.slice(0, limit).forEach((u, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ${String(u.totalRp).padStart(6)}  ${String(u.entries).padStart(4)}  ${String(u.wins).padStart(4)}  ${String(u.itm).padStart(4)}  ${String(u.best === Infinity ? '-' : u.best).padStart(4)}  ${u.totalPrize.toLocaleString().padStart(9)}  ${u.name}`
    );
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
