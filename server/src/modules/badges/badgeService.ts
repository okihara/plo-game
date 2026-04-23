import { prisma } from '../../config/database.js';

// --- バッジ定義 ---

export const BADGE_CATEGORIES = {
  HANDS: 'hands',
  WINS: 'wins',
  BAD_BEAT: 'bad_beat',
  DAILY_RANK: 'daily_rank',
  WEEKLY_RANK: 'weekly_rank',
  SPECIAL: 'special',
} as const;

type BadgeCategory = typeof BADGE_CATEGORIES[keyof typeof BADGE_CATEGORIES];

interface BadgeMeta {
  category: BadgeCategory;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
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
  first_penguin: { category: 'special', label: '1st Penguin', description: '2026/3/1以前に1ハンド以上をプレイ', flavor: '誰も知らないアプリに最初に飛び込んだ勇者の証 ありがとうございます', imageUrl: '/images/badges/penguin.png' },
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

// --- バッジ取得 ---

/** ユーザーのバッジ一覧を取得 */
export async function getUserBadges(userId: string): Promise<{ type: string; awardedAt: Date }[]> {
  return prisma.badge.findMany({
    where: { userId },
    select: { type: true, awardedAt: true },
    orderBy: { awardedAt: 'asc' },
  });
}

/** ウィークリーチャンピオン（weekly_rank_1）バッジを保有しているか（過去1回でもあればtrue） */
export async function hasWeeklyChampionBadge(userId: string): Promise<boolean> {
  const existing = await prisma.badge.findFirst({
    where: { userId, type: 'weekly_rank_1' },
    select: { id: true },
  });
  return !!existing;
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
  awardedAt: string;
}

/** DBのバッジレコードをカテゴリごとにグルーピングして表示用に変換 */
export function groupBadgesForDisplay(badges: { type: string; awardedAt: Date }[]): DisplayBadge[] {
  const result: DisplayBadge[] = [];

  // ハンド数カテゴリ: 最高レベルのみ表示
  const handBadges = badges.filter(b => BADGE_META[b.type]?.category === 'hands');
  if (handBadges.length > 0) {
    const highestType = HANDS_PRIORITY.find(t => handBadges.some(b => b.type === t));
    if (highestType) {
      const meta = BADGE_META[highestType];
      const badge = handBadges.find(b => b.type === highestType)!;
      result.push({
        category: meta.category,
        type: highestType,
        label: meta.label,
        description: meta.description,
        flavor: meta.flavor,
        imageUrl: meta.imageUrl,
        count: 1,
        awardedAt: badge.awardedAt.toISOString(),
      });
    }
  }

  // 勝利数カテゴリ: 最高レベルのみ表示
  const winBadges = badges.filter(b => BADGE_META[b.type]?.category === 'wins');
  if (winBadges.length > 0) {
    const highestType = WINS_PRIORITY.find(t => winBadges.some(b => b.type === t));
    if (highestType) {
      const meta = BADGE_META[highestType];
      const badge = winBadges.find(b => b.type === highestType)!;
      result.push({
        category: meta.category,
        type: highestType,
        label: meta.label,
        description: meta.description,
        flavor: meta.flavor,
        imageUrl: meta.imageUrl,
        count: 1,
        awardedAt: badge.awardedAt.toISOString(),
      });
    }
  }

  // バッドビートカテゴリ: 種類ごとに回数をカウント
  for (const bbType of ['bad_beat_fullhouse', 'bad_beat_quads', 'bad_beat_straight_flush'] as const) {
    const bbBadges = badges.filter(b => b.type === bbType);
    if (bbBadges.length > 0) {
      const meta = BADGE_META[bbType];
      const latest = bbBadges[bbBadges.length - 1];
      result.push({
        category: meta.category,
        type: bbType,
        label: meta.label,
        description: meta.description,
        flavor: meta.flavor,
        imageUrl: meta.imageUrl,
        count: bbBadges.length,
        awardedAt: latest.awardedAt.toISOString(),
      });
    }
  }

  // ランキングカテゴリ: 回数をカウント
  for (const rankType of ['daily_rank_1', 'weekly_rank_1'] as const) {
    const rankBadges = badges.filter(b => b.type === rankType);
    if (rankBadges.length > 0) {
      const meta = BADGE_META[rankType];
      const latest = rankBadges[rankBadges.length - 1];
      result.push({
        category: meta.category,
        type: rankType,
        label: meta.label,
        description: meta.description,
        flavor: meta.flavor,
        imageUrl: meta.imageUrl,
        count: rankBadges.length,
        awardedAt: latest.awardedAt.toISOString(),
      });
    }
  }

  // スペシャルカテゴリ: 1回限り（存在すれば表示）
  for (const badge of badges) {
    const meta = BADGE_META[badge.type];
    if (meta?.category === 'special') {
      result.push({
        category: meta.category,
        type: badge.type,
        label: meta.label,
        description: meta.description,
        flavor: meta.flavor,
        imageUrl: meta.imageUrl,
        count: 1,
        awardedAt: badge.awardedAt.toISOString(),
      });
    }
  }

  return result;
}
