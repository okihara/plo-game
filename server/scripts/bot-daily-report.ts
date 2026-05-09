/// <reference types="node" />
/**
 * Bot のリングゲーム成績デイリーレポートを生成する。
 *
 *   cd server && npx tsx scripts/bot-daily-report.ts            # ローカルDB、直近24h
 *   cd server && npx tsx scripts/bot-daily-report.ts --prod      # 本番DB、直近24h
 *   cd server && npx tsx scripts/bot-daily-report.ts --prod --hours=48
 *
 * 出力:
 *   server/scripts/reports/bot-daily-{YYYY-MM-DD}.md   (人間/Claude が読む)
 *   server/scripts/reports/bot-daily-{YYYY-MM-DD}.json (機械処理用の生データ)
 */
import { config } from 'dotenv';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { computeStats, type StoredAction } from '../src/modules/stats/computeStats.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const isProd = process.argv.includes('--prod');
const hoursArg = process.argv.find(a => a.startsWith('--hours='));
const hours = hoursArg ? Number(hoursArg.split('=')[1]) : 24;

if (isProd) {
  if (!process.env.DATABASE_PROD_PUBLIC_URL) {
    console.error('ERROR: DATABASE_PROD_PUBLIC_URL が server/.env に設定されていません');
    process.exit(1);
  }
  console.error('本番DBに接続します');
}

const prisma = new PrismaClient({
  datasources: isProd ? { db: { url: process.env.DATABASE_PROD_PUBLIC_URL } } : undefined,
});

interface ByBlinds {
  hands: number;
  profit: number;
  bb100: number;
}

type Position = 'BTN' | 'CO' | 'MP' | 'EP' | 'SB' | 'BB' | 'BTN/SB';

interface ByPosition {
  hands: number;
  profit: number;
  bb100: number;
}

interface BotResult {
  userId: string;
  username: string;
  displayName: string;
  hands: number;
  profit: number;
  evProfit: number;
  bb100: number;
  showdownReached: number;
  showdownWinRate: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  fourBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
  wtsd: number;
  wsd: number;
  byBlinds: Record<string, ByBlinds>;
  byPosition: Partial<Record<Position, ByPosition>>;
}

function bbFromBlinds(blinds: string): number {
  const parts = blinds.split('/');
  if (parts.length !== 2) return 0;
  return Number(parts[1]) || 0;
}

/**
 * ポジション判定。dealerPosition = BTN を起点に、SB / BB / 残りは BTN から逆向きに CO / MP / EP。
 * 2人席は BTN/SB と BB の 2 種のみ。dealerPosition < 0 (legacy) は null。
 */
function getPosition(
  seatPosition: number,
  dealerPosition: number,
  activeSeatPositions: number[],
): Position | null {
  if (dealerPosition < 0) return null;
  const sorted = [...activeSeatPositions].sort((a, b) => a - b);
  const n = sorted.length;
  const dealerIdx = sorted.indexOf(dealerPosition);
  const myIdx = sorted.indexOf(seatPosition);
  if (dealerIdx < 0 || myIdx < 0) return null;

  const distFromDealer = (myIdx - dealerIdx + n) % n;

  if (n === 2) {
    return distFromDealer === 0 ? 'BTN/SB' : 'BB';
  }

  if (distFromDealer === 0) return 'BTN';
  if (distFromDealer === 1) return 'SB';
  if (distFromDealer === 2) return 'BB';

  // 距離が dealer から大きいほど早いポジション
  // 6-max なら distFromDealer = 5 が CO, 4 が MP (HJ 含む), 3 が UTG/EP
  const stepsBeforeDealer = n - distFromDealer; // 1 = CO, 2 = MP, 3+ = EP
  if (stepsBeforeDealer === 1) return 'CO';
  if (stepsBeforeDealer === 2) return 'MP';
  return 'EP';
}

const POSITION_ORDER: Position[] = ['EP', 'MP', 'CO', 'BTN', 'BTN/SB', 'SB', 'BB'];

function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '') + n.toLocaleString();
}

async function main() {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const botUsers = await prisma.user.findMany({
    where: { provider: 'bot' },
    select: { id: true, username: true, displayName: true },
  });
  const botIds = botUsers.map(b => b.id);
  const botIdSet = new Set(botIds);
  console.error(`Bot 数: ${botUsers.length}, 期間: 直近${hours}h (${since.toISOString()} 以降)`);

  // bot がプレイしたリング戦のハンド ID を取得
  const handIdRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT DISTINCT hh.id
    FROM "HandHistory" hh
    JOIN "HandHistoryPlayer" hp ON hp."handHistoryId" = hh.id
    WHERE hh."tournamentId" IS NULL
      AND hh."createdAt" >= ${since}
      AND hp."userId" = ANY(${botIds}::text[])
  `;
  const handIds = handIdRows.map(r => r.id);
  console.error(`対象ハンド数: ${handIds.length}`);

  if (handIds.length === 0) {
    console.error('対象期間に Bot のリングハンドがありません');
    return;
  }

  // ハンド全体（プレイヤー含む）取得
  const BATCH = 500;
  const hands: Array<{
    id: string;
    actions: StoredAction[];
    dealerPosition: number;
    winners: string[];
    blinds: string;
    communityCards: string[];
    players: Array<{
      userId: string | null;
      seatPosition: number;
      profit: number;
      finalHand: string | null;
      allInEVProfit: number | null;
    }>;
  }> = [];

  for (let i = 0; i < handIds.length; i += BATCH) {
    const batch = handIds.slice(i, i + BATCH);
    const chunk = await prisma.handHistory.findMany({
      where: { id: { in: batch } },
      select: {
        id: true,
        actions: true,
        dealerPosition: true,
        winners: true,
        blinds: true,
        communityCards: true,
        players: {
          select: {
            userId: true,
            seatPosition: true,
            profit: true,
            finalHand: true,
            allInEVProfit: true,
          },
        },
      },
    });
    for (const h of chunk) {
      hands.push({
        id: h.id,
        actions: (h.actions as unknown as StoredAction[]) ?? [],
        dealerPosition: h.dealerPosition ?? -1,
        winners: h.winners,
        blinds: h.blinds,
        communityCards: h.communityCards,
        players: h.players,
      });
    }
  }

  // bot ごとに集計
  const results: BotResult[] = [];
  for (const bot of botUsers) {
    const botHands = hands.filter(h => h.players.some(p => p.userId === bot.id));
    if (botHands.length === 0) continue;

    const stats = computeStats(botHands, bot.id);

    // ブラインド帯別損益・bb/100、ポジション別損益・bb/100
    const byBlinds: Record<string, ByBlinds> = {};
    const byPosition: Partial<Record<Position, ByPosition & { bbSum: number }>> = {};
    let bbSum = 0;
    for (const h of botHands) {
      const me = h.players.find(p => p.userId === bot.id);
      if (!me) continue;
      const bb = bbFromBlinds(h.blinds);
      if (bb === 0) continue;
      const profitInBB = me.profit / bb;
      bbSum += profitInBB;
      if (!byBlinds[h.blinds]) byBlinds[h.blinds] = { hands: 0, profit: 0, bb100: 0 };
      byBlinds[h.blinds].hands++;
      byBlinds[h.blinds].profit += me.profit;

      const pos = getPosition(
        me.seatPosition,
        h.dealerPosition,
        h.players.map(p => p.seatPosition),
      );
      if (pos) {
        const bucket = byPosition[pos] ?? { hands: 0, profit: 0, bb100: 0, bbSum: 0 };
        bucket.hands++;
        bucket.profit += me.profit;
        bucket.bbSum += profitInBB;
        byPosition[pos] = bucket;
      }
    }
    for (const k of Object.keys(byBlinds)) {
      const s = byBlinds[k];
      const bb = bbFromBlinds(k);
      s.bb100 = bb > 0 && s.hands > 0 ? (s.profit / bb) / s.hands * 100 : 0;
    }
    const byPositionFinal: Partial<Record<Position, ByPosition>> = {};
    for (const [pos, bucket] of Object.entries(byPosition) as [Position, typeof byPosition[Position] & object][]) {
      if (!bucket) continue;
      byPositionFinal[pos] = {
        hands: bucket.hands,
        profit: bucket.profit,
        bb100: bucket.hands > 0 ? (bucket.bbSum / bucket.hands) * 100 : 0,
      };
    }
    const bb100 = stats.handsPlayed > 0 ? (bbSum / stats.handsPlayed) * 100 : 0;

    // ショーダウン勝率
    const sdHands = botHands.filter(h => h.players.some(p => p.userId === bot.id && p.finalHand));
    const sdWins = sdHands.filter(h => h.winners.includes(bot.id)).length;

    results.push({
      userId: bot.id,
      username: bot.username,
      displayName: bot.displayName ?? bot.username,
      hands: stats.handsPlayed,
      profit: stats.totalProfit,
      evProfit: stats.totalAllInEVProfit,
      bb100,
      showdownReached: sdHands.length,
      showdownWinRate: sdHands.length > 0 ? (sdWins / sdHands.length) * 100 : 0,
      vpip: stats.vpip,
      pfr: stats.pfr,
      threeBet: stats.threeBet,
      fourBet: stats.fourBet,
      afq: stats.afq,
      cbet: stats.cbet,
      foldToCbet: stats.foldToCbet,
      foldTo3Bet: stats.foldTo3Bet,
      wtsd: stats.wtsd,
      wsd: stats.wsd,
      byBlinds,
      byPosition: byPositionFinal,
    });
  }

  // 全体: bot vs human の損益・HU showdown 勝率
  let totalBotProfit = 0;
  let totalHumanProfit = 0;
  for (const h of hands) {
    for (const p of h.players) {
      if (!p.userId) continue;
      if (botIdSet.has(p.userId)) totalBotProfit += p.profit;
      else totalHumanProfit += p.profit;
    }
  }

  let huCount = 0;
  let huBotWin = 0;
  let huHumanWin = 0;
  let huSplit = 0;
  for (const h of hands) {
    const sd = h.players.filter(p => p.userId && p.finalHand);
    if (sd.length !== 2) continue;
    const [a, b] = sd;
    const aBot = botIdSet.has(a.userId!);
    const bBot = botIdSet.has(b.userId!);
    if (aBot === bBot) continue;
    huCount++;
    const botP = aBot ? a : b;
    const humanP = aBot ? b : a;
    const botWon = h.winners.includes(botP.userId!);
    const humanWon = h.winners.includes(humanP.userId!);
    if (botWon && humanWon) huSplit++;
    else if (botWon) huBotWin++;
    else if (humanWon) huHumanWin++;
  }

  // 改善対象を見つけやすいよう BB/100 の悪い順
  results.sort((x, y) => x.bb100 - y.bb100);

  const today = new Date().toISOString().slice(0, 10);
  const outDir = join(__dirname, 'reports');
  mkdirSync(outDir, { recursive: true });

  const overview = {
    totalRingHands: handIds.length,
    totalBotProfit,
    totalHumanProfit,
    activeBotCount: results.length,
    totalBotCount: botUsers.length,
    huBotVsHumanCount: huCount,
    huBotWinRate: huCount > 0 ? (huBotWin / huCount) * 100 : 0,
    huHumanWinRate: huCount > 0 ? (huHumanWin / huCount) * 100 : 0,
    huSplit,
  };

  const json = {
    generatedAt: new Date().toISOString(),
    rangeHours: hours,
    since: since.toISOString(),
    overview,
    bots: results,
  };
  const jsonPath = join(outDir, `bot-daily-${today}.json`);
  writeFileSync(jsonPath, JSON.stringify(json, null, 2));

  // Markdown
  const lines: string[] = [];
  lines.push(`# Bot リング戦 デイリーレポート (${today})`);
  lines.push('');
  lines.push(`期間: 直近 ${hours}h (${since.toISOString().slice(0, 16).replace('T', ' ')} UTC 以降)`);
  lines.push('');

  lines.push('## 全体サマリ');
  lines.push('');
  lines.push(`- 総リングハンド数: ${overview.totalRingHands.toLocaleString()}`);
  lines.push(`- Bot 総損益: ${fmtSigned(totalBotProfit)}`);
  lines.push(`- Human 総損益: ${fmtSigned(totalHumanProfit)}`);
  lines.push(`- アクティブ Bot 数: ${overview.activeBotCount} / ${overview.totalBotCount}`);
  if (huCount > 0) {
    lines.push(
      `- Bot vs Human HU showdown: ${huCount} ハンド (Bot 勝率 ${overview.huBotWinRate.toFixed(1)}%, Human 勝率 ${overview.huHumanWinRate.toFixed(1)}%, スプリット ${huSplit})`,
    );
  }
  lines.push('');

  const tableHeader =
    '| Bot | Hands | BB/100 | Profit | EV Profit | SD勝率 | VPIP | PFR | 3Bet | 4Bet | AFq | Cbet | F→Cbet | F→3Bet | WTSD | WSD |';
  const tableSep =
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';

  const renderRow = (b: BotResult) =>
    `| ${b.displayName} | ${b.hands} | ${b.bb100.toFixed(1)} | ${fmtSigned(b.profit)} | ${fmtSigned(b.evProfit)} | ${b.showdownWinRate.toFixed(1)}% | ${b.vpip.toFixed(1)} | ${b.pfr.toFixed(1)} | ${b.threeBet.toFixed(1)} | ${b.fourBet.toFixed(1)} | ${b.afq.toFixed(1)} | ${b.cbet.toFixed(1)} | ${b.foldToCbet.toFixed(1)} | ${b.foldTo3Bet.toFixed(1)} | ${b.wtsd.toFixed(1)} | ${b.wsd.toFixed(1)} |`;

  // hands >= 100 のみ調整対象として扱う
  const MIN_HANDS = 100;
  const eligible = results.filter(b => b.hands >= MIN_HANDS);
  const undersample = results.filter(b => b.hands < MIN_HANDS);

  lines.push(`> 集計対象は **hands >= ${MIN_HANDS}** の Bot のみ。サンプル不足は末尾に別掲。`);
  lines.push('');

  lines.push(`## ワースト 5 (BB/100 の悪い順, hands >= ${MIN_HANDS})`);
  lines.push('');
  lines.push(tableHeader);
  lines.push(tableSep);
  for (const b of eligible.slice(0, 5)) lines.push(renderRow(b));
  lines.push('');

  // ワースト 5 のポジション別内訳
  lines.push('### ワースト 5 のポジション別内訳');
  lines.push('');
  for (const b of eligible.slice(0, 5)) {
    lines.push(`#### ${b.displayName}`);
    lines.push('');
    lines.push('| Pos | Hands | Profit | BB/100 |');
    lines.push('|---|---:|---:|---:|');
    for (const pos of POSITION_ORDER) {
      const s = b.byPosition[pos];
      if (!s) continue;
      lines.push(`| ${pos} | ${s.hands} | ${fmtSigned(s.profit)} | ${s.bb100.toFixed(1)} |`);
    }
    lines.push('');
  }

  lines.push(`## ベスト 5 (BB/100 の良い順, hands >= ${MIN_HANDS})`);
  lines.push('');
  lines.push(tableHeader);
  lines.push(tableSep);
  for (const b of [...eligible].reverse().slice(0, 5)) lines.push(renderRow(b));
  lines.push('');

  lines.push(`## 全 Bot 一覧 (hands >= ${MIN_HANDS}, BB/100 悪い順)`);
  lines.push('');
  lines.push(tableHeader);
  lines.push(tableSep);
  for (const b of eligible) lines.push(renderRow(b));
  lines.push('');

  // ブラインド帯別の弱点スポット
  lines.push('## 改善候補スポット (30+ハンド かつ BB/100 < -10)');
  lines.push('');
  type Weak = { name: string; blinds: string; hands: number; profit: number; bb100: number };
  const weak: Weak[] = [];
  for (const b of results) {
    for (const [bl, st] of Object.entries(b.byBlinds)) {
      if (st.hands >= 30 && st.bb100 < -10) {
        weak.push({ name: b.displayName, blinds: bl, hands: st.hands, profit: st.profit, bb100: st.bb100 });
      }
    }
  }
  weak.sort((a, b) => a.bb100 - b.bb100);
  if (weak.length === 0) {
    lines.push('（該当なし）');
  } else {
    lines.push('| Bot | Blinds | Hands | Profit | BB/100 |');
    lines.push('|---|---|---:|---:|---:|');
    for (const w of weak.slice(0, 30)) {
      lines.push(`| ${w.name} | ${w.blinds} | ${w.hands} | ${fmtSigned(w.profit)} | ${w.bb100.toFixed(1)} |`);
    }
  }
  lines.push('');

  // サンプル不足 Bot（参考表示のみ、調整対象外）
  lines.push(`## サンプル不足 Bot (hands < ${MIN_HANDS}) — 参考のみ・調整対象外`);
  lines.push('');
  lines.push(`(${undersample.length} 体)`);
  lines.push('');
  if (undersample.length > 0) {
    lines.push('| Bot | Hands | BB/100 | Profit |');
    lines.push('|---|---:|---:|---:|');
    const sortedUnder = [...undersample].sort((a, b) => a.bb100 - b.bb100);
    for (const b of sortedUnder) {
      lines.push(`| ${b.displayName} | ${b.hands} | ${b.bb100.toFixed(1)} | ${fmtSigned(b.profit)} |`);
    }
  }
  lines.push('');

  const mdPath = join(outDir, `bot-daily-${today}.md`);
  writeFileSync(mdPath, lines.join('\n'));

  console.error(`✅ レポート出力完了`);
  console.error(`   md:   ${mdPath}`);
  console.error(`   json: ${jsonPath}`);
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
