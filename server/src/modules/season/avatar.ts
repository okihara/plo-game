import type { PrismaClient } from '@prisma/client';

interface AvatarFields {
  avatarUrl: string | null;
  twitterAvatarUrl: string | null;
  useTwitterAvatar: boolean;
}

/** ユーザー設定に応じて表示するアバター URL（Twitter アイコン優先設定を反映） */
export function resolveAvatarUrl(u: AvatarFields): string | null {
  return u.useTwitterAvatar && u.twitterAvatarUrl ? u.twitterAvatarUrl : u.avatarUrl ?? null;
}

/** userId → 表示アバター URL の対応を一括取得 */
export async function fetchAvatarUrls(prisma: PrismaClient, userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, avatarUrl: true, twitterAvatarUrl: true, useTwitterAvatar: true },
  });
  return new Map(users.map((u) => [u.id, resolveAvatarUrl(u)]));
}
