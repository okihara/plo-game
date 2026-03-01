import { prisma } from '../../config/database.js';

// --- バッジ定義 ---

export const BADGE_CATEGORIES = {
  HANDS: 'hands',
  DAILY_RANK: 'daily_rank',
  WEEKLY_RANK: 'weekly_rank',
} as const;

type BadgeCategory = typeof BADGE_CATEGORIES[keyof typeof BADGE_CATEGORIES];

interface BadgeMeta {
  category: BadgeCategory;
  label: string;
  description: string;
  icon: string;
}

const BADGE_META: Record<string, BadgeMeta> = {
  hands_100:     { category: 'hands', label: '100 Hands',   description: '100ハンドプレイ',              icon: '🃏' },
  hands_500:     { category: 'hands', label: '500 Hands',   description: '500ハンドプレイ',              icon: '🎴' },
  hands_1000:    { category: 'hands', label: '1K Hands',    description: '1,000ハンドプレイ',            icon: '🔥' },
  hands_5000:    { category: 'hands', label: '5K Hands',    description: '5,000ハンドプレイ',            icon: '💎' },
  daily_rank_1:  { category: 'daily_rank',  label: 'Daily #1',  description: 'デイリーランキング1位',  icon: '🥇' },
  weekly_rank_1: { category: 'weekly_rank', label: 'Weekly #1', description: 'ウィークリーランキング1位', icon: '🏆' },
};

const HAND_MILESTONES = [
  { threshold: 100,  type: 'hands_100' },
  { threshold: 500,  type: 'hands_500' },
  { threshold: 1000, type: 'hands_1000' },
  { threshold: 5000, type: 'hands_5000' },
];

// ハンド数バッジの優先順位（高い方が優先）
const HANDS_PRIORITY = ['hands_5000', 'hands_1000', 'hands_500', 'hands_100'];

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
  icon: string;
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
        icon: meta.icon,
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
        icon: meta.icon,
        count: rankBadges.length,
        awardedAt: latest.awardedAt.toISOString(),
      });
    }
  }

  return result;
}
