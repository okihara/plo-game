/**
 * シーズンの「面白い賞」を集計する。
 *
 * - 参加・継続系: TournamentResult から
 * - 成績系: TournamentResult + PrizeCalculator から
 * - スタイル/アグレ/オールイン系: シーズン期間内のトーナメントハンド（HandHistory）を
 *   走査し、既存の純粋関数 computeIncrementForPlayer を再利用して集計
 *
 * 少数サンプルの偶然受賞を避けるため、各賞に最低試合数/ハンド数のしきい値を設ける。
 */
import type { PrismaClient } from '@prisma/client';
import { PrizeCalculator } from '../tournament/PrizeCalculator.js';
import {
  computeIncrementForPlayer,
  emptyIncrement,
  type StatsIncrement,
} from '../stats/statsComputation.js';
import { CURRENT_SEASON } from './seasonConfig.js';
import { fetchSeasonTournaments, resolveDisplayName } from './computeSeasonRanking.js';

interface StoredAction {
  seatIndex: number;
  odId: string;
  odName?: string;
  action: string;
  amount: number;
  street?: string;
}

export interface AwardWinner {
  userId: string;
  name: string;
  avatarUrl: string | null;
  value: number;
  valueLabel: string;
}

export interface Award {
  key: string;
  category: string;
  title: string;
  emoji: string;
  description: string;
  winner: AwardWinner | null;
  runnersUp: AwardWinner[];
}

interface UserDisplay {
  name: string;
  avatarUrl: string | null;
}

interface ParticipationAcc {
  entries: number; // リエントリー込みの総エントリー数（バイイン回数）
  tournaments: number; // 出場トナメ数
  reentries: number;
  wins: number;
  itm: number;
}

interface StatAcc {
  inc: StatsIncrement;
  evDivergence: number; // sum(profit - allInEVProfit)。+ なら期待値以上に勝った
  allinHands: number;
  maxPotWon: number;
}

function addIncrement(acc: StatsIncrement, inc: StatsIncrement): void {
  acc.handsPlayed += inc.handsPlayed;
  acc.winCount += inc.winCount;
  acc.totalProfit += inc.totalProfit;
  acc.totalAllInEVProfit += inc.totalAllInEVProfit;
  acc.detailedHands += inc.detailedHands;
  acc.vpipCount += inc.vpipCount;
  acc.pfrCount += inc.pfrCount;
  acc.threeBetCount += inc.threeBetCount;
  acc.threeBetOpportunity += inc.threeBetOpportunity;
  acc.foldTo3BetCount += inc.foldTo3BetCount;
  acc.faced3BetCount += inc.faced3BetCount;
  acc.fourBetCount += inc.fourBetCount;
  acc.fourBetOpportunity += inc.fourBetOpportunity;
  acc.aggressiveActions += inc.aggressiveActions;
  acc.totalPostflopActions += inc.totalPostflopActions;
  acc.cbetCount += inc.cbetCount;
  acc.cbetOpportunity += inc.cbetOpportunity;
  acc.foldToCbetCount += inc.foldToCbetCount;
  acc.facedCbetCount += inc.facedCbetCount;
  acc.sawFlopCount += inc.sawFlopCount;
  acc.wtsdCount += inc.wtsdCount;
  acc.wsdCount += inc.wsdCount;
}

/** TournamentResult から参加・成績系の集計を行う。 */
function aggregateParticipation(
  tournaments: Awaited<ReturnType<typeof fetchSeasonTournaments>>,
): Map<string, ParticipationAcc> {
  const map = new Map<string, ParticipationAcc>();

  for (const t of tournaments) {
    const totalEntries = t.results.length + t.results.reduce((s, r) => s + (r.reentries ?? 0), 0);
    if (totalEntries < 2) continue;
    const itmCount = PrizeCalculator.calculate(totalEntries, t.prizePool).length;

    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      const cur = map.get(r.userId) ?? { entries: 0, tournaments: 0, reentries: 0, wins: 0, itm: 0 };
      cur.entries += 1 + (r.reentries ?? 0);
      cur.tournaments += 1;
      cur.reentries += r.reentries ?? 0;
      if (r.position === 1) cur.wins += 1;
      if (r.position <= itmCount) cur.itm += 1;
      map.set(r.userId, cur);
    }
  }

  return map;
}

/** シーズン期間内のトーナメントハンドを走査し、プレイヤー別のスタッツを集計する。 */
async function aggregateHandStats(prisma: PrismaClient, botIds: Set<string>): Promise<Map<string, StatAcc>> {
  const map = new Map<string, StatAcc>();
  // 全体の集計時間はデータ転送量に律速されバッチ径ではほぼ変わらないため、
  // 1バッチあたりの同期処理を小さめに保ち（イベントループ＝Socket.ioのping阻害を避ける）2000件ずつ走査する。
  const BATCH = 2000;
  let cursor: string | undefined;

  for (;;) {
    const hands = await prisma.handHistory.findMany({
      where: {
        tournamentId: { not: null },
        createdAt: { gte: CURRENT_SEASON.start, lte: CURRENT_SEASON.end },
      },
      select: {
        id: true,
        winners: true,
        communityCards: true,
        dealerPosition: true,
        potSize: true,
        actions: true,
        players: {
          select: {
            userId: true,
            username: true,
            seatPosition: true,
            finalHand: true,
            profit: true,
            allInEVProfit: true,
          },
        },
      },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    if (hands.length === 0) break;

    for (const h of hands) {
      const actions: StoredAction[] = Array.isArray(h.actions) ? (h.actions as unknown as StoredAction[]) : [];
      const activeSeatPositions = h.players.map((p) => p.seatPosition);
      const playersForCalc = h.players.map((p) => ({
        odId: p.userId ?? p.username,
        seatPosition: p.seatPosition,
        finalHand: p.finalHand,
      }));

      for (const p of h.players) {
        if (!p.userId || botIds.has(p.userId)) continue;

        const inc = computeIncrementForPlayer(
          p.userId,
          p.seatPosition,
          p.profit,
          actions,
          h.dealerPosition,
          h.winners,
          activeSeatPositions,
          h.communityCards.length,
          playersForCalc,
          p.allInEVProfit,
        );

        const cur = map.get(p.userId) ?? {
          inc: emptyIncrement(),
          evDivergence: 0,
          allinHands: 0,
          maxPotWon: 0,
        };
        addIncrement(cur.inc, inc);
        if (p.allInEVProfit != null) {
          cur.evDivergence += p.profit - p.allInEVProfit;
          cur.allinHands += 1;
        }
        if (h.winners.includes(p.userId) && h.potSize > cur.maxPotWon) {
          cur.maxPotWon = h.potSize;
        }
        map.set(p.userId, cur);
      }
    }

    if (hands.length < BATCH) break;
    cursor = hands[hands.length - 1].id;
  }

  return map;
}

interface Candidate {
  userId: string;
  value: number;
  valueLabel: string;
}

function buildAward(
  meta: { key: string; category: string; title: string; emoji: string; description: string },
  candidates: Candidate[],
  order: 'desc' | 'asc',
  displays: Map<string, UserDisplay>,
): Award {
  const sorted = [...candidates].sort((a, b) => (order === 'desc' ? b.value - a.value : a.value - b.value));
  const toWinner = (c: Candidate): AwardWinner | null => {
    const d = displays.get(c.userId);
    if (!d) return null;
    return { userId: c.userId, name: d.name, avatarUrl: d.avatarUrl, value: c.value, valueLabel: c.valueLabel };
  };
  const ranked = sorted.map(toWinner).filter((w): w is AwardWinner => w !== null);
  return {
    ...meta,
    winner: ranked[0] ?? null,
    runnersUp: ranked.slice(1, 3),
  };
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtSigned = (n: number) => (n >= 0 ? `+${fmtInt(n)}` : `-${fmtInt(-n)}`);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

export interface SeasonAwardsResult {
  awards: Award[];
  handsScanned: number;
}

export async function computeSeasonAwards(prisma: PrismaClient): Promise<SeasonAwardsResult> {
  const [tournaments, bots] = await Promise.all([
    fetchSeasonTournaments(prisma),
    prisma.user.findMany({ where: { provider: 'bot' }, select: { id: true } }),
  ]);
  const botIds = new Set(bots.map((b) => b.id));

  const participation = aggregateParticipation(tournaments);
  const stats = await aggregateHandStats(prisma, botIds);

  // 表示用ユーザー情報をまとめて取得
  const userIds = new Set<string>([...participation.keys(), ...stats.keys()]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...userIds] }, provider: { not: 'bot' } },
    select: {
      id: true,
      username: true,
      displayName: true,
      nameMasked: true,
      avatarUrl: true,
      twitterAvatarUrl: true,
      useTwitterAvatar: true,
    },
  });
  const displays = new Map<string, UserDisplay>();
  for (const u of users) {
    displays.set(u.id, {
      name: resolveDisplayName(u),
      avatarUrl: u.useTwitterAvatar && u.twitterAvatarUrl ? u.twitterAvatarUrl : u.avatarUrl ?? null,
    });
  }

  const handsScanned = [...stats.values()].reduce((s, a) => s + a.inc.handsPlayed, 0);

  // 派生指標を取り出すヘルパー
  const partList = [...participation.entries()].map(([userId, p]) => ({ userId, ...p }));
  const statList = [...stats.entries()].map(([userId, a]) => {
    const i = a.inc;
    return {
      userId,
      vpip: i.detailedHands > 0 ? (i.vpipCount / i.detailedHands) * 100 : null,
      afq: i.totalPostflopActions > 0 ? (i.aggressiveActions / i.totalPostflopActions) * 100 : null,
      threeBet: i.threeBetOpportunity > 0 ? (i.threeBetCount / i.threeBetOpportunity) * 100 : null,
      wsd: i.wtsdCount > 0 ? (i.wsdCount / i.wtsdCount) * 100 : null,
      detailedHands: i.detailedHands,
      postflopActions: i.totalPostflopActions,
      threeBetOpportunity: i.threeBetOpportunity,
      wtsd: i.wtsdCount,
      evDivergence: a.evDivergence,
      allinHands: a.allinHands,
      maxPotWon: a.maxPotWon,
    };
  });

  const awards: Award[] = [];

  // ===== 参加・継続系 =====
  awards.push(
    buildAward(
      { key: 'iron_man', category: '参加・継続', title: '鉄人賞', emoji: '🔥', description: '最も多くエントリーした皆勤の猛者' },
      partList.filter((p) => p.entries > 0).map((p) => ({ userId: p.userId, value: p.entries, valueLabel: `${p.entries}エントリー` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'reentry_king', category: '参加・継続', title: 'リエントリー王', emoji: '♻️', description: '何度でも立ち向かった不屈の人' },
      partList.filter((p) => p.reentries > 0).map((p) => ({ userId: p.userId, value: p.reentries, valueLabel: `${p.reentries}回` })),
      'desc',
      displays,
    ),
  );

  // ===== オールイン・アグレ系 =====
  awards.push(
    buildAward(
      { key: 'allin_master', category: 'オールイン・アグレ', title: 'オールイン無双賞', emoji: '💪', description: 'オールインで期待値以上に勝ち切った勝負師' },
      statList.filter((s) => s.allinHands >= 5).map((s) => ({ userId: s.userId, value: s.evDivergence, valueLabel: `EV ${fmtSigned(s.evDivergence)}` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'aggressive', category: 'オールイン・アグレ', title: 'アグレッシブ賞', emoji: '🚀', description: 'フロップ以降の攻撃性No.1' },
      statList.filter((s) => s.postflopActions >= 50 && s.afq != null).map((s) => ({ userId: s.userId, value: s.afq!, valueLabel: `AFq ${fmtPct(s.afq!)}` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'three_bet', category: 'オールイン・アグレ', title: '3ベット魔賞', emoji: '⚔️', description: 'プリフロップで殴り続けた3Bet師' },
      statList.filter((s) => s.threeBetOpportunity >= 20 && s.threeBet != null).map((s) => ({ userId: s.userId, value: s.threeBet!, valueLabel: `3Bet ${fmtPct(s.threeBet!)}` })),
      'desc',
      displays,
    ),
  );

  // ===== 成績・運系 =====
  awards.push(
    buildAward(
      { key: 'most_wins', category: '成績・運', title: '最多優勝賞', emoji: '🏆', description: 'トナメを制した回数No.1' },
      partList.filter((p) => p.wins > 0).map((p) => ({ userId: p.userId, value: p.wins, valueLabel: `${p.wins}回優勝` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'itm_master', category: '成績・運', title: 'インマネ職人賞', emoji: '🎯', description: '入賞率が最も高い堅実派（5戦以上）' },
      partList.filter((p) => p.tournaments >= 5).map((p) => ({ userId: p.userId, value: (p.itm / p.tournaments) * 100, valueLabel: `ITM率 ${Math.round((p.itm / p.tournaments) * 100)}% (${p.itm}/${p.tournaments})` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'biggest_pot', category: '成績・運', title: '一撃賞', emoji: '💥', description: 'シーズン最大のポットを攫った一発' },
      statList.filter((s) => s.maxPotWon > 0).map((s) => ({ userId: s.userId, value: s.maxPotWon, valueLabel: `${fmtInt(s.maxPotWon)} chips` })),
      'desc',
      displays,
    ),
  );

  // ===== スタイル系 =====
  awards.push(
    buildAward(
      { key: 'rock', category: 'スタイル', title: '鉄壁タイト賞', emoji: '🛡️', description: '滅多に参加しない鉄壁スタイル（50ハンド以上）' },
      // VPIP 0% は実質 AFK の全フォールド口座なので除外し、実際にプレイした最タイトを選ぶ
      statList.filter((s) => s.detailedHands >= 50 && s.vpip != null && s.vpip > 0).map((s) => ({ userId: s.userId, value: s.vpip!, valueLabel: `VPIP ${fmtPct(s.vpip!)}` })),
      'asc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'maniac', category: 'スタイル', title: 'ぶっぱルーズ賞', emoji: '🎪', description: 'とにかく参加するルーズスタイル（50ハンド以上）' },
      statList.filter((s) => s.detailedHands >= 50 && s.vpip != null).map((s) => ({ userId: s.userId, value: s.vpip!, valueLabel: `VPIP ${fmtPct(s.vpip!)}` })),
      'desc',
      displays,
    ),
  );
  awards.push(
    buildAward(
      { key: 'showdown_king', category: 'スタイル', title: 'ショーダウンの鬼賞', emoji: '👑', description: 'ショーダウンで勝ち切る勝負強さ（10回以上）' },
      statList.filter((s) => s.wtsd >= 10 && s.wsd != null).map((s) => ({ userId: s.userId, value: s.wsd!, valueLabel: `W$SD ${fmtPct(s.wsd!)}` })),
      'desc',
      displays,
    ),
  );

  return { awards, handsScanned };
}
