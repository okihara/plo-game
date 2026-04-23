/// <reference types="node" />
/**
 * 設計中の RP（ランクポイント）ルールで本番DBを集計し、通算ランキングをテキスト出力する。
 *
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --top=50
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --image=/tmp/rp.png
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --tsv
 *   cd server && npx tsx scripts/rank-points-ranking.ts --prod --diff   # 最新トナメ前後の順位差分をJSONで出力
 *
 * 付与ルール（案）:
 *   - 対象: TournamentResult が存在する完了トナメ
 *   - エントリー数 N = そのトナメの結果行数（Bot含む。リエントリーは最終順位のみカウント）
 *   - 付与人数 payoutCount(N):
 *       N<=6:3 / <=18:6 / <=27:9 / <=54:15 / <=100:25 / <=200:40 / それ以上: ceil(N*0.20)
 *   - RP(position, N) = round(BASE * positionFactor * fieldFactor)
 *       BASE=100
 *       positionFactor = 0.1 ^ ((pos-1)/(payoutCount-1))  ※payoutCount>=2 前提
 *       fieldFactor    = sqrt(N / 9)
 *   - Bot (User.provider='bot') はランキングから除外（エントリー数には含める）
 *   - 同順位（同時バスト）の扱いはデータ上 position が単純整数なのでそのまま
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'child_process';
import { maskName } from '../src/shared/utils.js';

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

const BASE = 100;

function payoutCount(n: number): number {
  if (n <= 6) return Math.min(3, n);
  if (n <= 18) return 6;
  if (n <= 27) return 9;
  if (n <= 54) return 15;
  if (n <= 100) return 25;
  if (n <= 200) return 40;
  return Math.ceil(n * 0.20);
}

const POSITION_DECAY_BASE = 0.05; // 小さいほど上位偏重
const WINNER_BONUS = 1.3;          // 1位のみ追加係数

function computeRp(position: number, entries: number): number {
  const pc = payoutCount(entries);
  if (position > pc) return 0;
  if (pc <= 1) return BASE;
  const positionFactor = Math.pow(POSITION_DECAY_BASE, (position - 1) / (pc - 1));
  const fieldFactor = Math.sqrt(entries / 9);
  const winnerMul = position === 1 ? WINNER_BONUS : 1;
  return Math.round(BASE * positionFactor * fieldFactor * winnerMul);
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
    where: { status: 'COMPLETED' },
    select: {
      id: true,
      name: true,
      completedAt: true,
      results: {
        select: {
          userId: true,
          position: true,
          prize: true,
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
    const N = t.results.length;
    if (N < 2) {
      tournamentsSkipped++;
      continue;
    }
    tournamentsCounted++;
    const pc = payoutCount(N);

    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      const rp = computeRp(r.position, N);
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
      if (r.position <= pc) cur.itm += 1;
      if (r.position < cur.best) cur.best = r.position;
      cur.totalPrize += r.prize;
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
    lines.push(`#title=BabyPLO トーナメント RP ランキング TOP ${limit}`);
    lines.push(`#subtitle=完了トナメ ${tournamentsCounted} 本ぶんの暫定集計（${today}時点）`);
    lines.push(`#footer=順位 × エントリー数で算出 / 1位ボーナス×1.3 / Bot除外`);
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

  console.log(`完了トナメ数: ${tournamentsCounted}（結果数<2 でスキップ: ${tournamentsSkipped}）`);
  console.log(`ランキング対象ユーザー: ${ranking.length} 人\n`);

  console.log('付与人数テーブル（N→payoutCount）:');
  for (const n of [6, 9, 12, 18, 27, 36, 54, 72, 100, 150, 200, 300, 500]) {
    console.log(`  N=${n.toString().padStart(4)} → ${payoutCount(n)}`);
  }
  console.log('\nRP例（N別の1位 / 最下位付賞）:');
  for (const n of [6, 9, 18, 27, 54, 100, 200]) {
    const pc = payoutCount(n);
    console.log(`  N=${n.toString().padStart(4)} (付与${pc}人): 1位=${computeRp(1, n)} / ${pc}位=${computeRp(pc, n)}`);
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
