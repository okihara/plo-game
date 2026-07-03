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
import { PrizeCalculator } from '../src/modules/tournament/PrizeCalculator.js';
import { CURRENT_SEASON } from '../src/modules/season/seasonConfig.js';
import {
  aggregateRanking,
  computeRankingDiff,
  fetchSeasonTournaments,
  rpFromAmount,
} from '../src/modules/season/computeSeasonRanking.js';

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

const SEASON_NAME = CURRENT_SEASON.name;
const SEASON_LABEL = CURRENT_SEASON.label;

async function main() {
  const tournaments = await fetchSeasonTournaments(prisma);

  if (DIFF) {
    // 集計ロジックは src/modules/season/computeSeasonRanking.ts が単一の源泉
    const diff = computeRankingDiff(tournaments, TOP);
    if (!diff) {
      console.error('完了トナメが2本未満のため差分を出せません');
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(diff, null, 2) + '\n');
    return;
  }

  const { ranking, tournamentsCounted, tournamentsSkipped } = aggregateRanking(tournaments);

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
