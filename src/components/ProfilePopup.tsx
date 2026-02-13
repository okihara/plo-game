import { useEffect, useState } from 'react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface PlayerStats {
  handsPlayed: number;
  winRate: number;
  totalProfit: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
  wtsd: number;
  wsd: number;
}

interface ProfilePopupProps {
  name: string;
  avatarUrl?: string | null;
  avatarId?: number;
  userId?: string;
  badges?: string[];
  onClose: () => void;
}

// avatarIdから画像パスを生成
const getAvatarImage = (avatarId: number): string => `/images/icons/avatar${avatarId}.png`;

export function ProfilePopup({
  name,
  avatarUrl,
  avatarId,
  userId,
  badges = [],
  onClose,
}: ProfilePopupProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const avatarImage = avatarUrl || (avatarId !== undefined ? getAvatarImage(avatarId) : null);

  // スタッツをAPIから取得
  useEffect(() => {
    if (!userId || userId.startsWith('guest_') || userId.startsWith('bot_')) return;

    setLoading(true);
    fetch(`${API_BASE}/api/stats/${userId}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (data?.stats) setStats(data.stats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

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
            {loading ? (
              <div className="flex flex-col items-center py-[4cqw]">
                <div className="w-[6cqw] h-[6cqw] border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <p className="text-white/40 text-[3cqw] mt-[2cqw]">読み込み中...</p>
              </div>
            ) : stats ? (
              <div className="grid grid-cols-3 gap-[2.5cqw]">
                <StatItem label="Hands" value={stats.handsPlayed.toLocaleString()} />
                <StatItem label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
                <StatItem label="Profit" value={formatProfit(stats.totalProfit)} color={stats.totalProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
                <StatItem label="VPIP" value={`${stats.vpip.toFixed(1)}%`} />
                <StatItem label="PFR" value={`${stats.pfr.toFixed(1)}%`} />
                <StatItem label="3Bet" value={`${stats.threeBet.toFixed(1)}%`} />
                <StatItem label="AFq" value={`${stats.afq.toFixed(1)}%`} />
                <StatItem label="CBet" value={`${stats.cbet.toFixed(1)}%`} />
                <StatItem label="Fold to CB" value={`${stats.foldToCbet.toFixed(1)}%`} />
                <StatItem label="Fold to 3B" value={`${stats.foldTo3Bet.toFixed(1)}%`} />
                <StatItem label="WTSD" value={`${stats.wtsd.toFixed(1)}%`} />
                <StatItem label="W$SD" value={`${stats.wsd.toFixed(1)}%`} />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-[3cqw]">
                <StatItem label="Hands" value="—" isPlaceholder />
                <StatItem label="Win Rate" value="—" isPlaceholder />
                <StatItem label="VPIP" value="—" isPlaceholder />
                <StatItem label="PFR" value="—" isPlaceholder />
                <StatItem label="3Bet" value="—" isPlaceholder />
                <StatItem label="WTSD" value="—" isPlaceholder />
              </div>
            )}
          </div>

          {/* No Stats Notice */}
          {!loading && !stats && (
            <p className="text-white/40 text-[3cqw] text-center mt-[3cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatProfit(profit: number): string {
  const sign = profit >= 0 ? '+' : '';
  return `${sign}${profit.toLocaleString()}`;
}

interface StatItemProps {
  label: string;
  value: string;
  isPlaceholder?: boolean;
  color?: string;
}

function StatItem({ label, value, isPlaceholder, color }: StatItemProps) {
  return (
    <div className="text-center">
      <div className={`text-[4.5cqw] font-bold ${isPlaceholder ? 'text-white/20' : color || 'text-white'}`}>
        {value}
      </div>
      <div className="text-white/50 text-[2.5cqw]">{label}</div>
    </div>
  );
}
