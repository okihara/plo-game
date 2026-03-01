/**
 * ファーストペンギンバッジ一括付与スクリプト
 * 2025/3/1 以前にプレイした全ユーザーに first_penguin バッジを付与
 *
 * 実行: cd server && npx tsx scripts/award-first-penguin.ts
 */
import { prisma } from '../src/config/database.js';

async function main() {
  const CUTOFF = new Date('2026-03-02T00:00:00Z'); // 3/1 JST end ≈ 3/2 UTC

  // 期限前にプレイしたユーザーを取得（bot含む）
  const players = await (prisma as any).handHistoryPlayer.findMany({
    where: {
      userId: { not: null },
      handHistory: { createdAt: { lt: CUTOFF } },
    },
    select: { userId: true },
    distinct: ['userId'],
  });

  const userIds: string[] = players.map((p: any) => p.userId).filter(Boolean);
  console.log(`対象ユーザー数: ${userIds.length}`);

  if (userIds.length === 0) {
    console.log('付与対象なし');
    return;
  }

  // 既に付与済みのユーザーを除外
  const existing = await (prisma as any).badge.findMany({
    where: { type: 'first_penguin', userId: { in: userIds } },
    select: { userId: true },
  });
  const existingSet = new Set(existing.map((b: any) => b.userId));
  const newUserIds = userIds.filter((id: string) => !existingSet.has(id));

  console.log(`既に付与済み: ${existingSet.size}`);
  console.log(`新規付与: ${newUserIds.length}`);

  if (newUserIds.length === 0) {
    console.log('全員付与済み');
    return;
  }

  const result = await (prisma as any).badge.createMany({
    data: newUserIds.map((userId: string) => ({ userId, type: 'first_penguin' })),
  });

  console.log(`✅ ${result.count} 人に first_penguin バッジを付与しました`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
