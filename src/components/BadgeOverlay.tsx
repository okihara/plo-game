/**
 * バッジ右上のオーバーレイ表示。
 * - 順位付きバッジ（シーズンTOP10など）は順位を表示
 * - それ以外で複数回獲得したバッジは ×獲得回数 を表示
 * PlayerProfile / ProfilePopup / CompactProfileModal で共用する。
 */
export function BadgeOverlay({ badge }: { badge: { rank?: number; count: number } }) {
  const text = badge.rank != null ? String(badge.rank) : badge.count > 1 ? `×${badge.count}` : null;
  if (text === null) return null;
  return (
    <span className="absolute -top-[0.5cqw] -right-[1cqw] bg-cream-900 text-white text-[1.8cqw] font-bold rounded-full min-w-[3.5cqw] h-[3.5cqw] flex items-center justify-center px-[0.3cqw]">
      {text}
    </span>
  );
}
