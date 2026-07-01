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
import { evaluatePLOHand, compareHands, type Card } from '@plo/shared';
import { PrizeCalculator } from '../tournament/PrizeCalculator.js';
import {
  computeIncrementForPlayer,
  emptyIncrement,
  type StatsIncrement,
} from '../stats/statsComputation.js';
import { CURRENT_SEASON } from './seasonConfig.js';
import { fetchSeasonTournaments, resolveDisplayName } from './computeSeasonRanking.js';

/** "Kc" のようなカード文字列を Card オブジェクトに変換 */
const toCard = (s: string): Card => ({ rank: s[0] as Card['rank'], suit: s[1] as Card['suit'] });

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

export interface ParticipationAcc {
  entries: number; // リエントリー込みの総エントリー数（バイイン回数）
  tournaments: number; // 出場トナメ数
  reentries: number;
  wins: number;
  itm: number;
  best: number; // 最高順位（未参加は Infinity）
  invested: number; // 総バイイン額（buyIn × エントリー数）
  returned: number; // 獲得賞金（RP/順位と一致する再算定額）
  roiSum: number; // 各トナメのROI（比）の合計（平均ROI算出用）
  roiCount: number; // ROIを計上したトナメ数（buyIn>0）
}

interface StatAcc {
  inc: StatsIncrement;
  allinHands: number; // オールインでランナウトまで行ったハンド数
  allinWins: number; // うち勝ったハンド数
  maxPotWon: number;
  knockouts: number; // 相手をバストさせた回数（撃墜数）
  riverSuckouts: number; // リバーでまくった回数（ターンで負けていてリバーで勝った）
  riverBadBeats: number; // リバーで捲られた回数（ターンで勝っていてリバーで負けた）
  bestHandRank: number; // シーズン最強の役の強さ（0=なし）
  bestHandName: string; // その役名
}

// 役カテゴリの強さ（finalHand は役名のみ保存されている）
const HAND_CATEGORY_RANK: Record<string, number> = {
  ハイカード: 1,
  ワンペア: 2,
  ツーペア: 3,
  スリーカード: 4,
  ストレート: 5,
  フラッシュ: 6,
  フルハウス: 7,
  フォーカード: 8,
  ストレートフラッシュ: 9,
  ロイヤルフラッシュ: 10,
};
const handCategory = (finalHand: string): string => finalHand.split(/[ ,（(]/)[0];

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
    const prizes = PrizeCalculator.calculate(totalEntries, t.prizePool);
    const amountByPosition = new Map<number, number>(prizes.map((p) => [p.position, p.amount]));
    const itmCount = prizes.length;

    for (const r of t.results) {
      if (r.user.provider === 'bot') continue;
      const entriesHere = 1 + (r.reentries ?? 0);
      const cur = map.get(r.userId) ?? { entries: 0, tournaments: 0, reentries: 0, wins: 0, itm: 0, best: Infinity, invested: 0, returned: 0, roiSum: 0, roiCount: 0 };
      cur.entries += entriesHere;
      cur.tournaments += 1;
      cur.reentries += r.reentries ?? 0;
      if (r.position === 1) cur.wins += 1;
      if (r.position <= itmCount) cur.itm += 1;
      if (r.position < cur.best) cur.best = r.position;
      const costHere = t.buyIn * entriesHere;
      const prizeHere = amountByPosition.get(r.position) ?? 0;
      cur.invested += costHere;
      cur.returned += prizeHere;
      if (costHere > 0) {
        cur.roiSum += (prizeHere - costHere) / costHere; // このトナメのROI（比）
        cur.roiCount += 1;
      }
      map.set(r.userId, cur);
    }
  }

  return map;
}

interface HandStatsResult {
  map: Map<string, StatAcc>;
  oppTable: Map<string, Map<string, number>>; // userId -> (相手userId -> 同卓ハンド数)
  oppHu: Map<string, Map<string, number>>; // userId -> (相手userId -> ヘッズアップ数)
}

/** シーズン期間内のトーナメントハンドを走査し、プレイヤー別のスタッツ＋対戦相手の共起を集計する。 */
async function aggregateHandStats(prisma: PrismaClient, botIds: Set<string>): Promise<HandStatsResult> {
  const map = new Map<string, StatAcc>();
  // 対戦相手の共起（Bot除外＝人間同士）。同卓＝同一ハンドに居合わせた回数、
  // HU＝卓4人以上でショーダウンに残ったのが2人だけの局面（短い卓での水増しを除外）。
  const oppTable = new Map<string, Map<string, number>>();
  const oppHu = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, a: string, b: string) => {
    let inner = m.get(a);
    if (!inner) {
      inner = new Map();
      m.set(a, inner);
    }
    inner.set(b, (inner.get(b) ?? 0) + 1);
  };
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
        communityCards2: true,
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
            startChips: true,
            holeCards: true,
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
          allinHands: 0,
          allinWins: 0,
          maxPotWon: 0,
          knockouts: 0,
          riverSuckouts: 0,
          riverBadBeats: 0,
          bestHandRank: 0,
          bestHandName: '',
        };
        addIncrement(cur.inc, inc);
        if (p.allInEVProfit != null) {
          cur.allinHands += 1;
          if (h.winners.includes(p.userId)) cur.allinWins += 1;
        }
        if (h.winners.includes(p.userId) && h.potSize > cur.maxPotWon) {
          cur.maxPotWon = h.potSize;
        }
        if (p.finalHand) {
          const cat = handCategory(p.finalHand);
          const rank = HAND_CATEGORY_RANK[cat] ?? 0;
          if (rank > cur.bestHandRank) {
            cur.bestHandRank = rank;
            cur.bestHandName = cat;
          }
        }
        map.set(p.userId, cur);
      }

      // 撃墜（KO）: このハンドでバストした相手数を、単独勝者に加算する。
      // バスト = ハンド開始時にチップがあり、終了時に 0 以下になった（トナメ敗退）。
      const victims = h.players.filter((pl) => pl.startChips > 0 && pl.startChips + pl.profit <= 0).length;
      if (victims > 0 && h.winners.length === 1) {
        const koId = h.winners[0];
        if (!botIds.has(koId)) {
          const cur = map.get(koId);
          if (cur) cur.knockouts += victims;
        }
      }

      // 同卓（人間同士）: 同一ハンドに居合わせた回数。卓サイズは問わない。
      const humanIds = h.players
        .map((pl) => pl.userId)
        .filter((id): id is string => !!id && !botIds.has(id));
      if (humanIds.length >= 2) {
        for (const a of humanIds) {
          for (const b of humanIds) {
            if (a !== b) bump(oppTable, a, b);
          }
        }
      }

      // ヘッズアップ（人間同士）: 卓に4人以上いるハンドで、ショーダウンに残ったのが
      // ちょうど2人の局面のみ数える（残り2〜3人の短い卓での水増しを避ける）。finalHand で判定。
      if (h.players.length >= 4) {
        const showdown = h.players.filter((pl) => pl.finalHand != null);
        if (showdown.length === 2) {
          const humans = showdown.filter((pl) => pl.userId && !botIds.has(pl.userId));
          if (humans.length === 2) {
            bump(oppHu, humans[0].userId as string, humans[1].userId as string);
            bump(oppHu, humans[1].userId as string, humans[0].userId as string);
          }
        }
      }

      // リバーで捲った/捲られた（近似: ターン=ボード4枚での最強完成手がリバー後に負けたか）。
      // PLO系(ホール4-6枚)・単一ボード・単独勝者のショーダウンのみ対象。ボムポット/非PLO/スプリットは除外。
      if (h.communityCards.length === 5 && h.communityCards2.length === 0 && h.winners.length === 1) {
        const showdown = h.players.filter(
          (pl) => pl.finalHand != null && pl.holeCards.length >= 4 && pl.holeCards.length <= 6,
        );
        if (showdown.length >= 2) {
          const turnBoard = h.communityCards.slice(0, 4).map(toCard);
          let leader: (typeof showdown)[number] | null = null;
          let leaderRank: ReturnType<typeof evaluatePLOHand> | null = null;
          let tiedTop = false;
          for (const pl of showdown) {
            const rank = evaluatePLOHand(pl.holeCards.map(toCard), turnBoard);
            const cmp = leaderRank ? compareHands(rank, leaderRank) : 1;
            if (cmp > 0) {
              leaderRank = rank;
              leader = pl;
              tiedTop = false;
            } else if (cmp === 0) {
              tiedTop = true;
            }
          }
          const winnerId = h.winners[0];
          if (leader && !tiedTop && !(leader.userId != null && leader.userId === winnerId)) {
            // ターン最強がリバーで負けた
            if (leader.userId && !botIds.has(leader.userId)) {
              const cur = map.get(leader.userId);
              if (cur) cur.riverBadBeats += 1;
            }
            if (!botIds.has(winnerId)) {
              const cur = map.get(winnerId);
              if (cur) cur.riverSuckouts += 1;
            }
          }
        }
      }
    }

    if (hands.length < BATCH) break;
    cursor = hands[hands.length - 1].id;
  }

  return { map, oppTable, oppHu };
}

interface Candidate {
  userId: string;
  value: number;
  valueLabel: string;
}

/** 各賞のフル順位（個人ページで「あなたは○位」を出すために全候補を保持） */
export interface AwardRanking {
  key: string;
  category: string;
  title: string;
  emoji: string;
  ranked: { userId: string; valueLabel: string }[];
}

/** 対戦相手の参照（一番同卓／一番ヘッズアップ） */
export interface MateRef {
  userId: string;
  name: string;
  avatarUrl: string | null;
  count: number;
}

/** プレイヤー別のハンド由来スタッツ（個人データセクション用） */
export interface PlayerHandStat {
  userId: string;
  hands: number; // handsPlayed（トナメ×シーズン期間）
  vpip: number | null;
  pfr: number | null;
  afq: number | null;
  threeBet: number | null;
  wsd: number | null;
  detailedHands: number;
  postflopActions: number;
  threeBetOpportunity: number;
  wtsd: number;
  nonShowdownWins: number; // ショーダウンせずに勝った回数
  allinHands: number;
  allinWins: number;
  maxPotWon: number;
  knockouts: number;
  riverSuckouts: number;
  riverBadBeats: number;
  bestHand: string | null; // シーズン最強の役名
  topTableMate: MateRef | null;
  topHuMate: MateRef | null;
}

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtPct = (n: number) => `${n.toFixed(1)}%`;
const fmtSignedPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;

interface AwardSpec {
  key: string;
  category: string;
  title: string;
  emoji: string;
  description: string;
  order: 'desc' | 'asc';
  candidates: Candidate[];
}

export interface SeasonAwardsResult {
  awards: Award[];
  rankings: AwardRanking[];
  participation: Map<string, ParticipationAcc>;
  statsByUser: Map<string, PlayerHandStat>;
  handsScanned: number;
}

export async function computeSeasonAwards(prisma: PrismaClient): Promise<SeasonAwardsResult> {
  const [tournaments, bots] = await Promise.all([
    fetchSeasonTournaments(prisma),
    prisma.user.findMany({ where: { provider: 'bot' }, select: { id: true } }),
  ]);
  const botIds = new Set(bots.map((b) => b.id));

  const participation = aggregateParticipation(tournaments);
  const { map: stats, oppTable, oppHu } = await aggregateHandStats(prisma, botIds);

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

  // 相手別カウントの最多を、表示情報を解決して MateRef にする
  const topMate = (counts: Map<string, number> | undefined): MateRef | null => {
    if (!counts) return null;
    let bestId: string | null = null;
    let best = 0;
    for (const [oid, c] of counts) {
      if (c > best) {
        best = c;
        bestId = oid;
      }
    }
    if (!bestId) return null;
    const d = displays.get(bestId);
    if (!d) return null;
    return { userId: bestId, name: d.name, avatarUrl: d.avatarUrl, count: best };
  };

  // 派生指標（個人データセクションでも再利用するため Map で保持）
  const statsByUser = new Map<string, PlayerHandStat>();
  for (const [userId, a] of stats.entries()) {
    const i = a.inc;
    statsByUser.set(userId, {
      userId,
      hands: i.handsPlayed,
      vpip: i.detailedHands > 0 ? (i.vpipCount / i.detailedHands) * 100 : null,
      pfr: i.detailedHands > 0 ? (i.pfrCount / i.detailedHands) * 100 : null,
      afq: i.totalPostflopActions > 0 ? (i.aggressiveActions / i.totalPostflopActions) * 100 : null,
      threeBet: i.threeBetOpportunity > 0 ? (i.threeBetCount / i.threeBetOpportunity) * 100 : null,
      wsd: i.wtsdCount > 0 ? (i.wsdCount / i.wtsdCount) * 100 : null,
      detailedHands: i.detailedHands,
      postflopActions: i.totalPostflopActions,
      threeBetOpportunity: i.threeBetOpportunity,
      wtsd: i.wtsdCount,
      nonShowdownWins: Math.max(0, i.winCount - i.wsdCount),
      allinHands: a.allinHands,
      allinWins: a.allinWins,
      maxPotWon: a.maxPotWon,
      knockouts: a.knockouts,
      riverSuckouts: a.riverSuckouts,
      riverBadBeats: a.riverBadBeats,
      bestHand: a.bestHandRank > 0 ? a.bestHandName : null,
      topTableMate: topMate(oppTable.get(userId)),
      topHuMate: topMate(oppHu.get(userId)),
    });
  }

  const partList = [...participation.entries()].map(([userId, p]) => ({ userId, ...p }));
  const statList = [...statsByUser.values()];

  // 賞の定義（スペック駆動）。candidates は受賞条件で絞り込んだ候補。
  const specs: AwardSpec[] = [
    // ===== 参加・継続系 =====
    {
      key: 'iron_man', category: '参加・継続', title: '鉄人賞', emoji: '🔥', description: '最も多くエントリーした皆勤の猛者', order: 'desc',
      candidates: partList.filter((p) => p.entries > 0).map((p) => ({ userId: p.userId, value: p.entries, valueLabel: `${p.entries}エントリー` })),
    },
    {
      key: 'reentry_king', category: '参加・継続', title: 'リエントリー王', emoji: '♻️', description: '何度でも立ち向かった不屈の人', order: 'desc',
      candidates: partList.filter((p) => p.reentries > 0).map((p) => ({ userId: p.userId, value: p.reentries, valueLabel: `${p.reentries}回` })),
    },
    // ===== オールイン・アグレ系 =====
    {
      key: 'allin_master', category: 'オールイン・アグレ', title: 'オールイン無双賞', emoji: '💪', description: 'オールインの勝率No.1（10ハンド以上）', order: 'desc',
      candidates: statList.filter((s) => s.allinHands >= 10).map((s) => {
        const rate = (s.allinWins / s.allinHands) * 100;
        return { userId: s.userId, value: rate, valueLabel: `勝率 ${fmtPct(rate)} (${s.allinWins}/${s.allinHands})` };
      }),
    },
    {
      key: 'aggressive', category: 'オールイン・アグレ', title: 'アグレッシブ賞', emoji: '🚀', description: 'フロップ以降の攻撃性No.1', order: 'desc',
      candidates: statList.filter((s) => s.postflopActions >= 50 && s.afq != null).map((s) => ({ userId: s.userId, value: s.afq!, valueLabel: `AFq ${fmtPct(s.afq!)}` })),
    },
    {
      key: 'three_bet', category: 'オールイン・アグレ', title: '3ベット王', emoji: '⚔️', description: 'プリフロップで殴り続けた3Bet師', order: 'desc',
      candidates: statList.filter((s) => s.threeBetOpportunity >= 20 && s.threeBet != null).map((s) => ({ userId: s.userId, value: s.threeBet!, valueLabel: `3Bet ${fmtPct(s.threeBet!)}` })),
    },
    // ===== 成績・運系 =====
    {
      key: 'most_wins', category: '成績・運', title: '最多優勝賞', emoji: '🏆', description: 'トナメを制した回数No.1', order: 'desc',
      candidates: partList.filter((p) => p.wins > 0).map((p) => ({ userId: p.userId, value: p.wins, valueLabel: `${p.wins}回優勝` })),
    },
    {
      key: 'itm_master', category: '成績・運', title: 'インマネ職人', emoji: '🎯', description: '入賞率が最も高い堅実派（5戦以上）', order: 'desc',
      candidates: partList.filter((p) => p.tournaments >= 5).map((p) => ({ userId: p.userId, value: (p.itm / p.tournaments) * 100, valueLabel: `ITM率 ${Math.round((p.itm / p.tournaments) * 100)}% (${p.itm}/${p.tournaments})` })),
    },
    {
      key: 'biggest_pot', category: '成績・運', title: '一撃王', emoji: '💥', description: 'シーズン最大のポットを攫った一発', order: 'desc',
      candidates: statList.filter((s) => s.maxPotWon > 0).map((s) => ({ userId: s.userId, value: s.maxPotWon, valueLabel: `${fmtInt(s.maxPotWon)} chips` })),
    },
    {
      key: 'knockout_king', category: '成績・運', title: '撃墜王', emoji: '🥊', description: '相手をバストさせた回数No.1', order: 'desc',
      candidates: statList.filter((s) => s.knockouts >= 3).map((s) => ({ userId: s.userId, value: s.knockouts, valueLabel: `${s.knockouts}KO` })),
    },
    {
      key: 'total_roi', category: '成績・運', title: '総ROI王', emoji: '📈', description: 'シーズン全体の投資収益率No.1（10戦以上）', order: 'desc',
      candidates: partList
        .filter((p) => p.tournaments >= 10 && p.invested > 0)
        .map((p) => {
          const roi = ((p.returned - p.invested) / p.invested) * 100;
          return { userId: p.userId, value: roi, valueLabel: `総ROI ${fmtSignedPct(roi)}` };
        }),
    },
    {
      key: 'avg_roi', category: '成績・運', title: '平均ROI王', emoji: '📊', description: '1トナメ平均の投資収益率No.1（10戦以上）', order: 'desc',
      candidates: partList
        .filter((p) => p.tournaments >= 10 && p.roiCount > 0)
        .map((p) => {
          const roi = (p.roiSum / p.roiCount) * 100;
          return { userId: p.userId, value: roi, valueLabel: `平均ROI ${fmtSignedPct(roi)}` };
        }),
    },
    // ===== スタイル系 =====
    {
      key: 'rock', category: 'スタイル', title: '鉄壁タイト賞', emoji: '🛡️', description: '滅多に参加しない鉄壁スタイル（50ハンド以上）', order: 'asc',
      // VPIP 0% は実質 AFK の全フォールド口座なので除外し、実際にプレイした最タイトを選ぶ
      candidates: statList.filter((s) => s.detailedHands >= 50 && s.vpip != null && s.vpip > 0).map((s) => ({ userId: s.userId, value: s.vpip!, valueLabel: `VPIP ${fmtPct(s.vpip!)}` })),
    },
    {
      key: 'maniac', category: 'スタイル', title: 'ハイVPIP', emoji: '🎪', description: 'とにかく参加するルーズスタイル（50ハンド以上）', order: 'desc',
      candidates: statList.filter((s) => s.detailedHands >= 50 && s.vpip != null).map((s) => ({ userId: s.userId, value: s.vpip!, valueLabel: `VPIP ${fmtPct(s.vpip!)}` })),
    },
    {
      key: 'showdown_king', category: 'スタイル', title: 'ショーダウンの鬼', emoji: '👑', description: 'ショーダウンで勝ち切る勝負強さ（10回以上）', order: 'desc',
      candidates: statList.filter((s) => s.wtsd >= 10 && s.wsd != null).map((s) => ({ userId: s.userId, value: s.wsd!, valueLabel: `ショーダウン勝利 ${fmtPct(s.wsd!)}` })),
    },
    {
      key: 'no_showdown_king', category: 'スタイル', title: 'ノーショーダウンの鬼', emoji: '🃏', description: 'ショーダウンせずに勝ち切った回数No.1（50ハンド以上）', order: 'desc',
      candidates: statList.filter((s) => s.hands >= 50).map((s) => ({ userId: s.userId, value: s.nonShowdownWins, valueLabel: `${s.nonShowdownWins}回` })),
    },
  ];

  const awards: Award[] = [];
  const rankings: AwardRanking[] = [];
  for (const spec of specs) {
    const sorted = [...spec.candidates].sort((a, b) => (spec.order === 'desc' ? b.value - a.value : a.value - b.value));
    rankings.push({
      key: spec.key,
      category: spec.category,
      title: spec.title,
      emoji: spec.emoji,
      ranked: sorted.map((c) => ({ userId: c.userId, valueLabel: c.valueLabel })),
    });
    const withDisplay = sorted
      .map((c): AwardWinner | null => {
        const d = displays.get(c.userId);
        return d ? { userId: c.userId, name: d.name, avatarUrl: d.avatarUrl, value: c.value, valueLabel: c.valueLabel } : null;
      })
      .filter((w): w is AwardWinner => w !== null);
    awards.push({
      key: spec.key,
      category: spec.category,
      title: spec.title,
      emoji: spec.emoji,
      description: spec.description,
      winner: withDisplay[0] ?? null,
      runnersUp: withDisplay.slice(1, 3),
    });
  }

  return { awards, rankings, participation, statsByUser, handsScanned };
}
