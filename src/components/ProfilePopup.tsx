import { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ProfitChart } from './ProfitChart';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface PlayerStats {
  handsPlayed: number;
  winRate: number;
  totalProfit: number;
  totalAllInEVProfit: number;
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
  isSelf?: boolean;
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
  isSelf = false,
  onClose,
}: ProfilePopupProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [profitHistory, setProfitHistory] = useState<{ p: number; c: number; s: number; n: number; e: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const { user, refreshUser } = useAuth();
  const [nameMasked, setNameMasked] = useState(user?.nameMasked ?? true);
  const [togglingMask, setTogglingMask] = useState(false);
  const [useTwitterAvatar, setUseTwitterAvatar] = useState(user?.useTwitterAvatar ?? false);
  const [togglingAvatar, setTogglingAvatar] = useState(false);
  const avatarImage = avatarUrl || (avatarId !== undefined ? getAvatarImage(avatarId) : null);

  // スタッツ＆収支推移をAPIから並列取得
  useEffect(() => {
    if (!userId || userId.startsWith('bot_')) return;

    setLoading(true);
    const fetches: Promise<any>[] = [
      fetch(`${API_BASE}/api/stats/${userId}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null),
    ];
    if (isSelf) {
      fetches.push(
        fetch(`${API_BASE}/api/stats/${userId}/profit-history`, { credentials: 'include' })
          .then(res => res.ok ? res.json() : null)
          .catch(() => null),
      );
    }
    Promise.all(fetches).then(([statsData, historyData]) => {
      if (statsData?.stats) setStats(statsData.stats);
      if (historyData?.points) setProfitHistory(historyData.points);
    }).finally(() => setLoading(false));
  }, [userId, isSelf]);

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
      className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={handleBackdropClick}
    >
      <div className="@container w-[80cqw]">
        <div className="bg-white rounded-[5cqw] p-[6cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.2)] animate-scale-in relative max-h-[85dvh] overflow-y-auto">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-[3cqw] right-[3cqw] text-cream-400 hover:text-cream-900 text-[7cqw] leading-none"
          >
            ×
          </button>

          {/* Avatar */}
          <div className="flex flex-col items-center mb-[4cqw]">
            <div className="w-[28cqw] h-[28cqw] rounded-full bg-gradient-to-br from-cream-200 to-cream-300 border-[1.2cqw] border-cream-300 overflow-hidden mb-[3cqw]">
              {avatarImage ? (
                <img src={avatarImage} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10cqw]">👤</div>
              )}
            </div>
            <h2 className="text-[6cqw] font-bold text-cream-900">{name}</h2>
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
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-cream-200 border border-cream-300 flex items-center justify-center">
                  <span className="text-cream-400 text-[4cqw]">?</span>
                </div>
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-cream-200 border border-cream-300 flex items-center justify-center">
                  <span className="text-cream-400 text-[4cqw]">?</span>
                </div>
                <div className="w-[12cqw] h-[12cqw] rounded-full bg-cream-200 border border-cream-300 flex items-center justify-center">
                  <span className="text-cream-400 text-[4cqw]">?</span>
                </div>
              </>
            )}
          </div>

          {/* Stats */}
          <div className="bg-cream-100 rounded-[4cqw] p-[5cqw]">
            <h3 className="text-cream-600 text-[3cqw] uppercase tracking-wider mb-[3cqw]">統計</h3>
            {loading ? (
              <div className="flex flex-col items-center py-[4cqw]">
                <div className="w-[6cqw] h-[6cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
                <p className="text-cream-500 text-[3cqw] mt-[2cqw]">読み込み中...</p>
              </div>
            ) : stats ? (
              <div className="grid grid-cols-3 gap-[2.5cqw]">
                <StatItem label="Hands" value={stats.handsPlayed.toLocaleString()} />
                <StatItem label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
                <StatItem label="Profit" value={formatProfit(stats.totalProfit)} color={stats.totalProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                <StatItem label="EV Profit" value={formatProfit(stats.totalAllInEVProfit ?? stats.totalProfit)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
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

          {/* Profit Chart (self only) */}
          {isSelf && !loading && profitHistory.length >= 2 && (
            <div className="bg-cream-100 rounded-[4cqw] p-[5cqw] mt-[3cqw]">
              <ProfitChart points={profitHistory} />
            </div>
          )}

          {/* No Stats Notice */}
          {!loading && !stats && (
            <p className="text-cream-500 text-[3cqw] text-center mt-[3cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}

          {/* Settings Toggles (self only) */}
          {isSelf && (
            <div className="mt-[4cqw] space-y-[2cqw]">
              {/* Name Mask Toggle */}
              <div className="flex items-center justify-between bg-cream-100 rounded-[4cqw] px-[5cqw] py-[4cqw]">
                <div>
                  <div className="text-cream-900 text-[3.5cqw] font-semibold">名前を公開</div>
                  <div className="text-cream-500 text-[2.5cqw]">他プレイヤーに表示</div>
                </div>
                <button
                  disabled={togglingMask}
                  onClick={async () => {
                    setTogglingMask(true);
                    try {
                      const res = await fetch(`${API_BASE}/api/auth/name-mask`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ nameMasked: !nameMasked }),
                      });
                      if (res.ok) {
                        setNameMasked(!nameMasked);
                        refreshUser();
                      }
                    } catch { /* ignore */ }
                    finally { setTogglingMask(false); }
                  }}
                  className={`relative w-[12cqw] h-[6.5cqw] rounded-full transition-colors duration-200 ${!nameMasked ? 'bg-forest' : 'bg-cream-300'} ${togglingMask ? 'opacity-50' : ''}`}
                >
                  <div className={`absolute top-[0.75cqw] w-[5cqw] h-[5cqw] bg-white rounded-full shadow transition-transform duration-200 ${!nameMasked ? 'translate-x-[6.25cqw]' : 'translate-x-[0.75cqw]'}`} />
                </button>
              </div>

              {/* Twitter Avatar Toggle */}
              <div className="flex items-center justify-between bg-cream-100 rounded-[4cqw] px-[5cqw] py-[4cqw]">
                <div>
                  <div className="text-cream-900 text-[3.5cqw] font-semibold">Xのアイコンを使用</div>
                  <div className="text-cream-500 text-[2.5cqw]">次回着席時から反映</div>
                </div>
                <button
                  disabled={togglingAvatar}
                  onClick={async () => {
                    setTogglingAvatar(true);
                    try {
                      const res = await fetch(`${API_BASE}/api/auth/twitter-avatar`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ useTwitterAvatar: !useTwitterAvatar }),
                      });
                      if (res.ok) {
                        setUseTwitterAvatar(!useTwitterAvatar);
                        refreshUser();
                      }
                    } catch { /* ignore */ }
                    finally { setTogglingAvatar(false); }
                  }}
                  className={`relative w-[12cqw] h-[6.5cqw] rounded-full transition-colors duration-200 ${useTwitterAvatar ? 'bg-forest' : 'bg-cream-300'} ${togglingAvatar ? 'opacity-50' : ''}`}
                >
                  <div className={`absolute top-[0.75cqw] w-[5cqw] h-[5cqw] bg-white rounded-full shadow transition-transform duration-200 ${useTwitterAvatar ? 'translate-x-[6.25cqw]' : 'translate-x-[0.75cqw]'}`} />
                </button>
              </div>
            </div>
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

const statInfo: Record<string, { desc: string; formula: string }> = {
  Hands:       { desc: 'プレイしたハンド数', formula: '参加ハンドの合計' },
  'Win Rate':  { desc: '勝利したハンドの割合', formula: '勝利数 ÷ 総ハンド数 × 100' },
  Profit:      { desc: '総損益（チップ）', formula: '全ハンドの獲得チップ合計' },
  'EV Profit': { desc: 'オールイン時のエクイティに基づく期待損益', formula: 'Σ(エクイティ × ポット額 - ベット額)' },
  VPIP:        { desc: '自発的にポットに参加した割合', formula: '(コール+レイズ) ÷ 総ハンド数 × 100' },
  PFR:         { desc: 'プリフロップでレイズした割合', formula: 'PFレイズ数 ÷ 総ハンド数 × 100' },
  '3Bet':      { desc: 'プリフロップで3ベットした割合', formula: '3ベット数 ÷ 3ベット機会数 × 100' },
  AFq:         { desc: 'ポストフロップのアグレッション頻度', formula: '(ベット+レイズ) ÷ (ベット+レイズ+コール+フォールド) × 100' },
  CBet:        { desc: 'PFレイザーがフロップでベットした割合', formula: 'Cベット数 ÷ Cベット機会数 × 100' },
  'Fold to CB': { desc: 'Cベットに対してフォールドした割合', formula: 'CB被フォールド数 ÷ CB被回数 × 100' },
  'Fold to 3B': { desc: '3ベットに対してフォールドした割合', formula: '3B被フォールド数 ÷ 3B被回数 × 100' },
  WTSD:        { desc: 'フロップ参加後ショウダウンまで行った割合', formula: 'SD到達数 ÷ フロップ参加数 × 100' },
  'W$SD':      { desc: 'ショウダウンで勝利した割合', formula: 'SD勝利数 ÷ SD到達数 × 100' },
};

interface StatItemProps {
  label: string;
  value: string;
  isPlaceholder?: boolean;
  color?: string;
}

function StatItem({ label, value, isPlaceholder, color }: StatItemProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const info = statInfo[label];

  useEffect(() => {
    if (!showTooltip) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showTooltip]);

  return (
    <div className="text-center relative">
      <div className={`text-[4.5cqw] font-bold ${isPlaceholder ? 'text-cream-400' : color || 'text-cream-900'}`}>
        {value}
      </div>
      <div className="text-cream-600 text-[2.5cqw] flex items-center justify-center gap-[1cqw]">
        {label}
        {info && !isPlaceholder && (
          <span
            onClick={(e) => { e.stopPropagation(); setShowTooltip(v => !v); }}
            className="inline-flex items-center justify-center w-[3.5cqw] h-[3.5cqw] rounded-full border border-cream-400 text-cream-500 text-[2cqw] leading-none cursor-pointer hover:text-cream-700 hover:border-cream-600 shrink-0"
          >
            i
          </span>
        )}
      </div>
      {showTooltip && info && (
        <div
          ref={tooltipRef}
          className="absolute z-[300] bottom-full left-1/2 -translate-x-1/2 mb-[1.5cqw] w-[55cqw] bg-cream-900 border border-cream-700 rounded-[2cqw] p-[3cqw] shadow-xl"
        >
          <div className="text-white text-[2.8cqw] font-semibold mb-[1.5cqw]">{label}</div>
          <div className="text-white/70 text-[2.5cqw] mb-[1.5cqw]">{info.desc}</div>
          <div className="text-emerald-300 text-[2.2cqw] bg-black/30 rounded-[1.5cqw] px-[2cqw] py-[1.5cqw]">
            {info.formula}
          </div>
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[2cqw] border-r-[2cqw] border-t-[2cqw] border-l-transparent border-r-transparent border-t-cream-700" />
        </div>
      )}
    </div>
  );
}
