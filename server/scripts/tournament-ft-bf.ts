/// <reference types="node" />
/**
 * 直近トナメ（または指定 ID）の FT (Final Table) ハンドを取得し、
 * 各ハンド開始時点の全プレイヤーについて
 *   - 名前
 *   - チップ数
 *   - 負けたときに失う $EV (lossEv)
 *   - 勝ったときに得る $EV (gainEv)
 *   - バブルファクター BF = lossEv / gainEv
 * を出力する。
 *
 *   cd server && npx tsx scripts/tournament-ft-bf.ts --prod
 *   cd server && npx tsx scripts/tournament-ft-bf.ts --prod --tournament <id>
 *   cd server && npx tsx scripts/tournament-ft-bf.ts --prod --max-players 9
 *   cd server && npx tsx scripts/tournament-ft-bf.ts --prod --json
 *
 * FT 判定: ハンド開始時点で着席プレイヤー数 <= --max-players (デフォルト 6) のハンド。
 * FT 形成後は 1 テーブルに集約されるため、着席数 = 残存トナメプレイヤー数。
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { computeICM } from '@plo/shared';
import { PrizeCalculator } from '../src/modules/tournament/PrizeCalculator.js';
import { maskName } from '../src/shared/utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const argv = process.argv.slice(2);
const isProd = argv.includes('--prod');
const asJson = argv.includes('--json');

function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const tournamentIdArg = flagValue('--tournament');
const maxPlayers = Number(flagValue('--max-players') ?? '6');

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

interface UserRef {
  id: string;
  username: string;
  displayName: string | null;
  nameMasked: boolean;
}

function resolveDisplay(u: UserRef | null): string {
  if (!u) return '(unknown)';
  return u.displayName || (u.nameMasked ? maskName(u.username) : u.username);
}

interface PerPlayerBF {
  name: string;
  chips: number;
  icmNow: number;
  gainEv: number;
  lossEv: number;
  bf: number;
}

/**
 * computeBubbleFactors と同じロジックだが、lossEv / gainEv も返す。
 * packages/shared/src/icm.ts の symmetric fair-exchange 方式に従う。
 */
function computeBFDetails(stacks: number[], payouts: number[]): {
  icmNow: number[];
  gainEv: number[];
  lossEv: number[];
  bf: number[];
} {
  const n = stacks.length;
  const icmNow = computeICM(stacks, payouts);
  const gainEv = new Array<number>(n).fill(NaN);
  const lossEv = new Array<number>(n).fill(NaN);
  const bf = new Array<number>(n).fill(NaN);

  const totalChips = stacks.reduce((a, b) => a + b, 0);
  if (totalChips <= 0) return { icmNow, gainEv, lossEv, bf };

  const aliveCount = stacks.reduce((c, s) => c + (s > 0 ? 1 : 0), 0);
  const bustPrize = aliveCount - 1 < payouts.length ? payouts[aliveCount - 1] : 0;

  for (let i = 0; i < n; i++) {
    const myChips = stacks[i];
    if (myChips <= 0) continue;
    const others = totalChips - myChips;
    if (others <= 0) continue;
    const tradeAmount = Math.min(myChips, others);

    const stacksWin = stacks.slice();
    stacksWin[i] = myChips + tradeAmount;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      stacksWin[j] = stacks[j] - (stacks[j] / others) * tradeAmount;
    }
    const icmWin = computeICM(stacksWin, payouts);
    gainEv[i] = icmWin[i] - icmNow[i];

    let loss: number;
    const newStack = myChips - tradeAmount;
    if (newStack <= 0) {
      loss = icmNow[i] - bustPrize;
    } else {
      const stacksLose = stacks.slice();
      stacksLose[i] = newStack;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        stacksLose[j] = stacks[j] + (stacks[j] / others) * tradeAmount;
      }
      const icmLose = computeICM(stacksLose, payouts);
      loss = icmNow[i] - icmLose[i];
    }
    lossEv[i] = loss;
    if (gainEv[i] > 0) bf[i] = loss / gainEv[i];
  }

  return { icmNow, gainEv, lossEv, bf };
}

function fmtMoney(v: number): string {
  if (!Number.isFinite(v)) return '   -   ';
  return v.toFixed(2);
}
function fmtBF(v: number): string {
  if (!Number.isFinite(v)) return ' - ';
  return v.toFixed(3);
}
function fmtBlinds(b: unknown): string {
  if (typeof b === 'string') return b;
  if (b && typeof b === 'object') {
    const o = b as { smallBlind?: number; bigBlind?: number; ante?: number };
    const ante = o.ante ? `/${o.ante}` : '';
    return `${o.smallBlind ?? '?'}/${o.bigBlind ?? '?'}${ante}`;
  }
  return '';
}

async function main() {
  const tournament = tournamentIdArg
    ? await prisma.tournament.findUnique({ where: { id: tournamentIdArg } })
    : await prisma.tournament.findFirst({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      });

  if (!tournament) {
    console.error('対象のトナメが見つかりません');
    process.exit(1);
  }
  console.error(
    `対象トナメ: ${tournament.name} (${tournament.id}) status=${tournament.status} prizePool=${tournament.prizePool}`,
  );

  const registrations = await prisma.tournamentRegistration.findMany({
    where: { tournamentId: tournament.id },
    select: { reentryCount: true },
  });
  const totalEntries = registrations.reduce((s, r) => s + 1 + r.reentryCount, 0);

  const customPercentages = Array.isArray(tournament.payoutPercentage)
    ? (tournament.payoutPercentage as unknown as number[])
    : undefined;

  const prizes = PrizeCalculator.calculate(totalEntries, tournament.prizePool, customPercentages);
  const payouts = prizes.map((p) => p.amount);

  console.error(
    `エントリー: ${totalEntries} (登録 ${registrations.length} + リエントリー ${totalEntries - registrations.length}), 入賞 ${prizes.length} 人`,
  );
  console.error(`賞金構造: ${payouts.join(', ')}`);

  const hands = await prisma.handHistory.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { createdAt: 'asc' },
    include: {
      players: {
        include: {
          user: { select: { id: true, username: true, displayName: true, nameMasked: true } },
        },
      },
    },
  });

  // FT 判定: ハンド開始時の着席チップ合計がトナメ総チップ数と一致するハンドは
  // 「生き残ったプレイヤー全員がこの卓にいる = 1卓集約済み」を意味するので FT とみなす。
  // (re-entry はレジ締めまでに完了するため、FT 到達時には totalEntries × startingChips が
  //  確定したトナメ総チップ数になる)
  const tournamentTotalChips = totalEntries * tournament.startingChips;
  const ftHands = hands.filter((h) => {
    if (h.players.length === 0 || h.players.length > maxPlayers) return false;
    const sum = h.players.reduce((s, p) => s + p.startChips, 0);
    return sum === tournamentTotalChips;
  });
  console.error(
    `総ハンド数: ${hands.length}, トナメ総チップ ${tournamentTotalChips}, FT (<=${maxPlayers}人 & 全チップ集約) ハンド数: ${ftHands.length}`,
  );

  if (asJson) {
    const out = ftHands.map((h) => {
      const sorted = [...h.players].sort((a, b) => b.startChips - a.startChips);
      const stacks = sorted.map((p) => p.startChips);
      const names = sorted.map((p) => resolveDisplay(p.user));
      const { icmNow, gainEv, lossEv, bf } = computeBFDetails(stacks, payouts);
      return {
        handNumber: h.handNumber,
        createdAt: h.createdAt,
        blinds: h.blinds,
        playersAlive: sorted.length,
        players: sorted.map((p, i) => ({
          name: names[i],
          userId: p.userId,
          chips: stacks[i],
          icmNow: icmNow[i],
          gainEv: gainEv[i],
          lossEv: lossEv[i],
          bf: bf[i],
        })),
      };
    });
    console.log(JSON.stringify({
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      totalEntries,
      prizePool: tournament.prizePool,
      payouts,
      maxPlayersForFT: maxPlayers,
      hands: out,
    }, null, 2));
    await prisma.$disconnect();
    return;
  }

  // テキスト出力
  for (const h of ftHands) {
    const sorted = [...h.players].sort((a, b) => b.startChips - a.startChips);
    const stacks = sorted.map((p) => p.startChips);
    const names = sorted.map((p) => resolveDisplay(p.user));
    const { icmNow, gainEv, lossEv, bf } = computeBFDetails(stacks, payouts);

    const totalChips = stacks.reduce((a, b) => a + b, 0);
    console.log('');
    console.log(
      `=== Hand #${h.handNumber}  blinds=${fmtBlinds(h.blinds)}  alive=${sorted.length}  totalChips=${totalChips}  (${h.createdAt.toISOString()}) ===`,
    );
    const nameW = Math.max(12, ...names.map((n) => Math.min(24, [...n].length)));
    const header =
      `${'name'.padEnd(nameW)}  ${'chips'.padStart(10)}  ${'icmNow'.padStart(8)}  ${'lossEv'.padStart(8)}  ${'gainEv'.padStart(8)}  ${'BF'.padStart(6)}`;
    console.log(header);
    console.log('-'.repeat(header.length));
    for (let i = 0; i < sorted.length; i++) {
      const truncName = names[i].length > nameW ? names[i].slice(0, nameW - 1) + '…' : names[i];
      console.log(
        `${truncName.padEnd(nameW)}  ${String(stacks[i]).padStart(10)}  ${fmtMoney(icmNow[i]).padStart(8)}  ${fmtMoney(lossEv[i]).padStart(8)}  ${fmtMoney(gainEv[i]).padStart(8)}  ${fmtBF(bf[i]).padStart(6)}`,
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
