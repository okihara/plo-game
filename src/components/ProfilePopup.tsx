import { useEffect } from 'react';

interface PlayerStats {
  handsPlayed: number;
  winRate: number;
  vpip: number;    // Voluntarily Put In Pot %
  pfr: number;     // Pre-Flop Raise %
  afq: number;     // Aggression Frequency %
  wtsd: number;    // Went To ShowDown %
}

interface ProfilePopupProps {
  name: string;
  avatarUrl?: string | null;
  avatarId?: number;
  stats?: PlayerStats | null;  // nullの場合はプレースホルダー表示
  badges?: string[];           // バッジID配列（将来用）
  onClose: () => void;
}

// デフォルトのプレースホルダースタッツ
const placeholderStats: PlayerStats = {
  handsPlayed: 0,
  winRate: 0,
  vpip: 0,
  pfr: 0,
  afq: 0,
  wtsd: 0,
};

// avatarIdから画像パスを生成
const getAvatarImage = (avatarId: number): string => `/images/icons/avatar${avatarId}.png`;

export function ProfilePopup({
  name,
  avatarUrl,
  avatarId,
  stats,
  badges = [],
  onClose,
}: ProfilePopupProps) {
  const displayStats = stats || placeholderStats;
  const avatarImage = avatarUrl || (avatarId !== undefined ? getAvatarImage(avatarId) : null);

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 背景クリックで閉じる
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={handleBackdropClick}
    >
      <div className="@container w-[80cqw]">
        <div className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-[5cqw] p-[6cqw] border border-white/10 shadow-2xl animate-scale-in relative">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-[3cqw] right-[3cqw] text-white/60 hover:text-white text-[7cqw] leading-none"
          >
            ×
          </button>

          {/* Avatar */}
          <div className="flex flex-col items-center mb-[4cqw]">
            <div className="w-[28cqw] h-[28cqw] rounded-full bg-gradient-to-br from-gray-500 to-gray-700 border-[1.2cqw] border-white/20 overflow-hidden mb-[3cqw]">
              {avatarImage ? (
                <img src={avatarImage} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10cqw]">👤</div>
              )}
            </div>
            <h2 className="text-[6cqw] font-bold text-white">{name}</h2>
          </div>

          {/* Badges Placeholder */}
          <div className="flex justify-center gap-[2.5cqw] mb-[5cqw]">
            {badges.length > 0 ? (
              badges.map((_, i) => (
                <div
                  key={i}
                  className="w-[12cqw] h-[12cqw] rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-[5cqw]"
                >
                  🏆
                </div>
              ))
            ) : (
              // プレースホルダーバッジ
              <>
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <span className="text-white/20 text-[4cqw]">?</span>
                </div>
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <span className="text-white/20 text-[4cqw]">?</span>
                </div>
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                  <span className="text-white/20 text-[4cqw]">?</span>
                </div>
              </>
            )}
          </div>

          {/* Stats */}
          <div className="bg-black/30 rounded-[4cqw] p-[5cqw]">
            <h3 className="text-white/60 text-[3cqw] uppercase tracking-wider mb-[3cqw]">統計</h3>
            <div className="grid grid-cols-2 gap-[3cqw]">
              <StatItem label="ハンド数" value={displayStats.handsPlayed.toLocaleString()} isPlaceholder={!stats} />
              <StatItem label="勝率" value={`${displayStats.winRate.toFixed(1)}%`} isPlaceholder={!stats} />
              <StatItem label="VPIP" value={`${displayStats.vpip.toFixed(1)}%`} isPlaceholder={!stats} />
              <StatItem label="PFR" value={`${displayStats.pfr.toFixed(1)}%`} isPlaceholder={!stats} />
              <StatItem label="AFq" value={`${displayStats.afq.toFixed(1)}%`} isPlaceholder={!stats} />
              <StatItem label="WTSD" value={`${displayStats.wtsd.toFixed(1)}%`} isPlaceholder={!stats} />
            </div>
          </div>

          {/* No Stats Notice */}
          {!stats && (
            <p className="text-white/40 text-[3cqw] text-center mt-[3cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string;
  isPlaceholder: boolean;
}

function StatItem({ label, value, isPlaceholder }: StatItemProps) {
  return (
    <div className="text-center">
      <div className={`text-[5cqw] font-bold ${isPlaceholder ? 'text-white/20' : 'text-white'}`}>
        {isPlaceholder ? '—' : value}
      </div>
      <div className="text-white/50 text-[3cqw]">{label}</div>
    </div>
  );
}
