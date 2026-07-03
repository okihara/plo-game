import { prisma } from '../../config/database.js';
import type { NameplateDecoration } from '@plo/shared';

// --- バッジ定義 ---

export const BADGE_CATEGORIES = {
  HANDS: 'hands',
  WINS: 'wins',
  BAD_BEAT: 'bad_beat',
  DAILY_RANK: 'daily_rank',
  WEEKLY_RANK: 'weekly_rank',
  TOURNAMENT: 'tournament',
  SEASON_RANK: 'season_rank',
  SPECIAL: 'special',
} as const;

type BadgeCategory = typeof BADGE_CATEGORIES[keyof typeof BADGE_CATEGORIES];

interface BadgeMeta {
  category: BadgeCategory;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
  /** 右上に実順位（rank）を表示するか。絵柄に順位が無い順位帯バッジ（TOP10/TOP30）で true。 */
  showRank?: boolean;
}

const BADGE_META: Record<string, BadgeMeta> = {
  hands_1000:    { category: 'hands', label: '1000 Hands',  description: '1000ハンドプレイ',             flavor: '紙束',                           imageUrl: '/images/badges/hands_1000.png' },
  hands_3000:    { category: 'hands', label: '3000 Hands',  description: '3000ハンドプレイ',             flavor: '辞書',                        imageUrl: '/images/badges/hands_3000.png' },
  hands_10000:   { category: 'hands', label: '10K Hands',   description: '10,000ハンドプレイ',           flavor: '図書館',                imageUrl: '/images/badges/hands_10000.png' },
  wins_10:       { category: 'wins', label: '10 Wins',    description: '10勝達成',                  flavor: '初めの一歩',                         imageUrl: '/images/badges/wins_10.png' },
  wins_100:      { category: 'wins', label: '100 Wins',   description: '100勝達成',                 flavor: '百戦錬磨',                           imageUrl: '/images/badges/wins_100.png' },
  wins_500:      { category: 'wins', label: '500 Wins',   description: '500勝達成',                 flavor: '歴戦の覇者',                         imageUrl: '/images/badges/wins_500.png' },
  bad_beat_fullhouse:      { category: 'bad_beat', label: 'Bad Beat',          description: 'フルハウス以上で負けた',                  flavor: 'それでも負ける',                      imageUrl: '/images/badges/bad_beat_fullhouse.png' },
  bad_beat_quads:          { category: 'bad_beat', label: 'Quad Cracked',      description: 'フォーカードで負けた',                    flavor: '四つ揃えてもダメだった',               imageUrl: '/images/badges/bad_beat_quads.png' },
  bad_beat_straight_flush: { category: 'bad_beat', label: 'SF Cracked',        description: 'ストレートフラッシュで負けた',            flavor: '神に見放された',                       imageUrl: '/images/badges/bad_beat_straight_flush.png' },
  daily_rank_1:  { category: 'daily_rank',  label: 'Daily Crown',  description: 'デイリーランキング1位',  flavor: 'あの日のチップは全てあなたの手に',                           imageUrl: '/images/badges/daily_rank.png' },
  weekly_rank_1: { category: 'weekly_rank', label: 'Weekly Crown', description: 'ウィークリーランキング1位', flavor: '不眠不休の王',                          imageUrl: '/images/badges/weekly_rank.png' },
  tournament_no1: { category: 'tournament', label: 'Tournament Winner', description: 'トーナメント優勝',     flavor: '賞金を全て持っていった',                  imageUrl: '/images/badges/tournament_no1.png' },
  season1_no1:    { category: 'season_rank', label: 'シーズン1 1位',   description: 'シーズン1 RPランキング 1位',    flavor: 'シーズンの頂点に立った者',       imageUrl: '/images/badges/season1_no1.png' },
  season1_no2:    { category: 'season_rank', label: 'シーズン1 2位',   description: 'シーズン1 RPランキング 2位',    flavor: '頂まであと一歩',                 imageUrl: '/images/badges/season1_no2.png' },
  season1_no3:    { category: 'season_rank', label: 'シーズン1 3位',   description: 'シーズン1 RPランキング 3位',    flavor: '表彰台の一角を勝ち取った',        imageUrl: '/images/badges/season1_no3.png' },
  season1_top10:  { category: 'season_rank', label: 'シーズン1 TOP10', description: 'シーズン1 RPランキング TOP10入り', flavor: 'シーズンを駆け抜けた強者の証',  imageUrl: '/images/badges/season1_top10.png', showRank: true },
  season1_top30:  { category: 'season_rank', label: 'シーズン1 TOP30', description: 'シーズン1 RPランキング TOP30入り', flavor: '上位30人に名を刻んだ',        imageUrl: '/images/badges/season1_top30.png', showRank: true },
  season1_member: { category: 'season_rank', label: 'シーズン1 参加',  description: 'シーズン1 トーナメント参加記念', flavor: 'このシーズンを共に戦った証',      imageUrl: '/images/badges/season1_member.png' },
  first_penguin: { category: 'special', label: '1st Penguin', description: '2026/3/1以前に1ハンド以上をプレイ', flavor: '誰も知らないアプリに最初に飛び込んだ勇者の証 ありがとうございます', imageUrl: '/images/badges/penguin.png' },
  special_guest_ryutaro: { category: 'special', label: 'Special Guest りゅうたろう', description: 'スペシャルゲスト りゅうたろう 参加記念', flavor: 'ダブルブレスレットホルダーと卓を囲んで戦った証', imageUrl: '/images/badges/special_guest_ryutaro.png' },
};

const HAND_MILESTONES = [
  { threshold: 1000,  type: 'hands_1000' },
  { threshold: 3000,  type: 'hands_3000' },
  { threshold: 10000, type: 'hands_10000' },
];

const WIN_MILESTONES = [
  { threshold: 10,   type: 'wins_10' },
  { threshold: 100,  type: 'wins_100' },
  { threshold: 500,  type: 'wins_500' },
];

// ハンド数バッジの優先順位（高い方が優先）
const HANDS_PRIORITY = ['hands_10000', 'hands_3000', 'hands_1000'];

// 勝利数バッジの優先順位（高い方が優先）
const WINS_PRIORITY = ['wins_500', 'wins_100', 'wins_10'];

// --- バッジ付与 ---

/** ハンド数マイルストーンバッジのチェック＆付与 */
export async function checkHandCountBadges(userId: string, handsPlayed: number): Promise<void> {
  for (const { threshold, type } of HAND_MILESTONES) {
    if (handsPlayed >= threshold) {
      // 既に付与済みか確認してから作成（ハンド数系は1回だけ）
      const existing = await prisma.badge.findFirst({
        where: { userId, type },
      });
      if (!existing) {
        await prisma.badge.create({
          data: { userId, type },
        });
      }
    }
  }
}

// /** 勝利数マイルストーンバッジのチェック＆付与 */
// export async function checkWinCountBadges(userId: string, winCount: number): Promise<void> {
//   for (const { threshold, type } of WIN_MILESTONES) {
//     if (winCount >= threshold) {
//       const existing = await prisma.badge.findFirst({
//         where: { userId, type },
//       });
//       if (!existing) {
//         await prisma.badge.create({
//           data: { userId, type },
//         });
//       }
//     }
//   }
// }

/** バッドビートバッジの付与（回数蓄積） */
export async function awardBadBeatBadge(
  userId: string,
  type: 'bad_beat_fullhouse' | 'bad_beat_quads' | 'bad_beat_straight_flush'
): Promise<void> {
  await prisma.badge.create({
    data: { userId, type },
  });
}

/**
 * ショーダウン結果からバッドビートを検出して付与
 * @param losers - 負けたプレイヤーの情報 [{ odId, handRank, handName }]
 * @param winners - 勝ったプレイヤーの情報 [{ handRank, handName }]
 */
export async function checkBadBeatBadges(
  losers: { odId: string; handRank: number }[],
  winnerHandRanks: number[],
): Promise<void> {
  const highestWinnerRank = Math.max(...winnerHandRanks);

  for (const loser of losers) {
    // ストレートフラッシュ (rank 9) で負けた
    if (loser.handRank === 9) {
      await awardBadBeatBadge(loser.odId, 'bad_beat_straight_flush');
    }
    // フォーカード (rank 8) で負けた
    if (loser.handRank === 8) {
      await awardBadBeatBadge(loser.odId, 'bad_beat_quads');
    }
    // フルハウス以上 (rank >= 7) で負けた
    if (loser.handRank >= 7) {
      await awardBadBeatBadge(loser.odId, 'bad_beat_fullhouse');
    }
  }
}

/** ランキングバッジの付与（毎回新レコードで回数蓄積） */
export async function awardRankingBadge(userId: string, type: 'daily_rank_1' | 'weekly_rank_1'): Promise<void> {
  await prisma.badge.create({
    data: { userId, type },
  });
}

/** トーナメント優勝バッジの付与（毎回新レコードで回数蓄積） */
export async function awardTournamentBadge(userId: string, type: 'tournament_no1'): Promise<void> {
  await prisma.badge.create({
    data: { userId, type },
  });
}

/** バッジ type の表示メタ（画像URL・ラベル）を返す。未定義 type は null。 */
export function badgeDisplayMeta(type: string): { imageUrl: string; label: string } | null {
  const meta = BADGE_META[type];
  return meta ? { imageUrl: meta.imageUrl, label: meta.label } : null;
}

/** シーズンバッジ type 一覧（付与・集計時の対象抽出に使う）。順位帯の高い順。 */
export function seasonBadgeTypes(prefix: string): string[] {
  return [`${prefix}_no1`, `${prefix}_no2`, `${prefix}_no3`, `${prefix}_top10`, `${prefix}_top30`, `${prefix}_member`];
}

/**
 * シーズンRPランキングの順位（1始まり）→ 付与するバッジ type を返す。
 * rank が null（RP圏外の参加者）は参加記念バッジ。
 */
export function seasonBadgeTypeForRank(prefix: string, rank: number | null): string {
  if (rank === 1) return `${prefix}_no1`;
  if (rank === 2) return `${prefix}_no2`;
  if (rank === 3) return `${prefix}_no3`;
  if (rank != null && rank <= 10) return `${prefix}_top10`;
  if (rank != null && rank <= 30) return `${prefix}_top30`;
  return `${prefix}_member`;
}

// --- バッジ取得 ---

/** ユーザーのバッジ一覧を取得 */
export async function getUserBadges(userId: string): Promise<{ type: string; rank: number | null; awardedAt: Date }[]> {
  return prisma.badge.findMany({
    where: { userId },
    select: { type: true, rank: true, awardedAt: true },
    orderBy: { awardedAt: 'asc' },
  });
}

// --- ネームプレート装飾 ---

/**
 * 装飾ごとの対象バッジ type。配列の先頭の装飾ほど優先される
 * （複数該当時は最初にマッチしたものだけが付く）。
 * 新しい装飾は NameplateDecoration にリテラルを足した上でここに1エントリ追加する。
 */
const NAMEPLATE_RULES: { decoration: NameplateDecoration; badgeTypes: string[] }[] = [
  { decoration: 'season_top3', badgeTypes: ['season1_no1', 'season1_no2', 'season1_no3'] },
  { decoration: 'weekly_champion', badgeTypes: ['weekly_rank_1'] },
];

/** 保有バッジからネームプレート装飾を解決する（該当なしは undefined） */
export async function resolveNameplate(userId: string): Promise<NameplateDecoration | undefined> {
  const owned = await prisma.badge.findMany({
    where: { userId, type: { in: NAMEPLATE_RULES.flatMap(r => r.badgeTypes) } },
    select: { type: true },
  });
  const ownedTypes = new Set(owned.map(b => b.type));
  return NAMEPLATE_RULES.find(r => r.badgeTypes.some(t => ownedTypes.has(t)))?.decoration;
}

// --- 表示用グルーピング ---

export interface DisplayBadge {
  category: string;
  type: string;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
  count: number;
  /** 順位付きバッジ（シーズンTOP10など）の順位。順位を持たないバッジは省略。 */
  rank?: number;
  awardedAt: string;
}

type BadgeRecord = { type: string; rank: number | null; awardedAt: Date };

/**
 * カテゴリごとの表示方法。配列順 = 表示順。新カテゴリはここに1エントリ足す。
 * - highest:        優先順リストの最上位1枚だけ表示（ハンド数・勝利数）
 * - count_per_type: type ごとに1枚、保有数を count に表示（バッドビート・ランキング等）
 * - best_per_type:  type ごとに1枚、最良 rank を表示（シーズンランキング）
 * - per_record:     レコードごとにそのまま表示（スペシャル）
 */
const DISPLAY_RULES: (
  | { category: BadgeCategory; mode: 'highest'; priority: string[] }
  | { category: BadgeCategory; mode: 'count_per_type' | 'best_per_type' | 'per_record' }
)[] = [
  { category: 'hands', mode: 'highest', priority: HANDS_PRIORITY },
  { category: 'wins', mode: 'highest', priority: WINS_PRIORITY },
  { category: 'bad_beat', mode: 'count_per_type' },
  { category: 'daily_rank', mode: 'count_per_type' },
  { category: 'weekly_rank', mode: 'count_per_type' },
  { category: 'tournament', mode: 'count_per_type' },
  { category: 'season_rank', mode: 'best_per_type' },
  { category: 'special', mode: 'per_record' },
];

/** BADGE_META の定義順を保った、カテゴリ内の type 一覧 */
function typesInCategory(category: BadgeCategory): string[] {
  return Object.keys(BADGE_META).filter(t => BADGE_META[t].category === category);
}

function toDisplayBadge(type: string, count: number, awardedAt: Date, rank?: number): DisplayBadge {
  const meta = BADGE_META[type];
  return {
    category: meta.category,
    type,
    label: meta.label,
    description: meta.description,
    flavor: meta.flavor,
    imageUrl: meta.imageUrl,
    count,
    rank,
    awardedAt: awardedAt.toISOString(),
  };
}

/** DBのバッジレコードをカテゴリごとにグルーピングして表示用に変換 */
export function groupBadgesForDisplay(badges: BadgeRecord[]): DisplayBadge[] {
  const result: DisplayBadge[] = [];

  for (const rule of DISPLAY_RULES) {
    const inCategory = badges.filter(b => BADGE_META[b.type]?.category === rule.category);
    if (inCategory.length === 0) continue;

    switch (rule.mode) {
      case 'highest': {
        const highestType = rule.priority.find(t => inCategory.some(b => b.type === t));
        if (highestType) {
          const badge = inCategory.find(b => b.type === highestType)!;
          result.push(toDisplayBadge(highestType, 1, badge.awardedAt));
        }
        break;
      }
      case 'count_per_type': {
        for (const type of typesInCategory(rule.category)) {
          const ofType = inCategory.filter(b => b.type === type);
          if (ofType.length === 0) continue;
          result.push(toDisplayBadge(type, ofType.length, ofType[ofType.length - 1].awardedAt));
        }
        break;
      }
      case 'best_per_type': {
        // 保有バッジの出現順で type ごとに1枚、最良 rank を採用
        const distinctTypes = Array.from(new Set(inCategory.map(b => b.type)));
        for (const type of distinctTypes) {
          const bestBadge = inCategory
            .filter(b => b.type === type)
            .reduce((best, b) => ((b.rank ?? Infinity) < (best.rank ?? Infinity) ? b : best));
          // 絵柄に順位が無い順位帯バッジ（TOP10/TOP30）だけ実順位をオーバーレイ表示
          const rank = BADGE_META[type].showRank ? (bestBadge.rank ?? undefined) : undefined;
          result.push(toDisplayBadge(type, 1, bestBadge.awardedAt, rank));
        }
        break;
      }
      case 'per_record': {
        for (const badge of inCategory) {
          result.push(toDisplayBadge(badge.type, 1, badge.awardedAt));
        }
        break;
      }
    }
  }

  return result;
}
