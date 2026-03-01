import { prisma } from '../../config/database.js';

// --- バッジ定義 ---

export const BADGE_CATEGORIES = {
  HANDS: 'hands',
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
  daily_rank_1:  { category: 'daily_rank',  label: 'Daily Crown',  description: 'デイリーランキング1位',  flavor: 'あの日のチップは全てあなたの手に',                           imageUrl: '/images/badges/daily_rank.png' },
  weekly_rank_1: { category: 'weekly_rank', label: 'Weekly Crown', description: 'ウィークリーランキング1位', flavor: '不眠不休の王',                          imageUrl: '/images/badges/weekly_rank.png' },
  first_penguin: { category: 'special', label: '1st Penguin', description: '2026/3/1以前に1ハンド以上をプレイ', flavor: '誰も知らないアプリに最初に飛び込んだ勇者の証 ありがとうございます', imageUrl: '/images/badges/penguin.png' },
};

const HAND_MILESTONES = [
  { threshold: 1000,  type: 'hands_1000' },
  { threshold: 3000,  type: 'hands_3000' },
  { threshold: 10000, type: 'hands_10000' },
];

// ハンド数バッジの優先順位（高い方が優先）
const HANDS_PRIORITY = ['hands_10000', 'hands_3000', 'hands_1000'];

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
