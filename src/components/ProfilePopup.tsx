import { useEffect, useState, useRef } from 'react';
import { Pencil, Share2, Link, Check } from 'lucide-react';
import { ProfitChart } from './ProfitChart';
import { ProfileEditDialog } from './ProfileEditDialog';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface PlayerStats {
  handsPlayed: number;
  winRate: number;
  totalProfit: number;
  totalAllInEVProfit: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  fourBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
  wtsd: number;
  wsd: number;
}

interface DisplayBadge {
  category: string;
  type: string;
  label: string;
  description: string;
  flavor: string;
  imageUrl: string;
  count: number;
  awardedAt: string;
}

interface ProfilePopupProps {
  name: string;
  avatarUrl?: string | null;
  avatarId?: number;
  userId?: string;
  isSelf?: boolean;
  onClose: () => void;
  onProfileUpdated?: () => void;
  twitterAvatarUrl?: string | null;
  useTwitterAvatar?: boolean;
  initialShowEdit?: boolean;
}

// avatarIdから画像パスを生成
const getAvatarImage = (avatarId: number): string => `/images/icons/avatar${avatarId}.png`;


export function ProfilePopup({
  name,
  avatarUrl,
  avatarId,
  userId,
  isSelf = false,
  onClose,
  onProfileUpdated,
  twitterAvatarUrl,
  useTwitterAvatar = false,
  initialShowEdit = false,
}: ProfilePopupProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [badges, setBadges] = useState<DisplayBadge[]>([]);
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const badgeTooltipRef = useRef<HTMLDivElement>(null);
  const [profitHistory, setProfitHistory] = useState<{ p: number; c: number; s: number; n: number; e: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(initialShowEdit);
  const [copied, setCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);

  const shareUrl = userId ? `${window.location.origin}/player/${userId}` : '';

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = shareUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setShowShareMenu(false);
  };

  const handleShareX = () => {
    const text = 'Baby PLO でのスタッツをチェック!';
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(shareUrl)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
    setShowShareMenu(false);
  };
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
      if (statsData?.badges) setBadges(statsData.badges);
      if (historyData?.points) setProfitHistory(historyData.points);
    }).finally(() => setLoading(false));
  }, [userId, isSelf]);

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showEditDialog) {
          setShowEditDialog(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, showEditDialog]);

  // バッジツールチップの外側タップで閉じる
  useEffect(() => {
    if (!activeBadge) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (badgeTooltipRef.current && !badgeTooltipRef.current.contains(e.target as Node)) {
        setActiveBadge(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [activeBadge]);

  return (
    <div
      className="absolute inset-0 bg-white z-[200] flex flex-col"
    >
      <div className="@container w-full flex-1 overflow-y-auto">
        <div className="px-[4cqw] pt-[4cqw] pb-[2cqw] relative">

          {/* Avatar + Name */}
          <div className="flex items-center gap-[3cqw] mb-[1.5cqw]">
            <div className="w-[12cqw] h-[12cqw] rounded-full bg-gradient-to-br from-cream-200 to-cream-300 border-[0.6cqw] border-cream-300 overflow-hidden shrink-0">
              {avatarImage ? (
                <img src={avatarImage} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[5cqw]">👤</div>
              )}
            </div>
            <div className="flex items-center gap-[1.5cqw] min-w-0 flex-1">
              <h2 className="text-[4.5cqw] font-bold text-cream-900 truncate">{name}</h2>
              {isSelf && (
                <button
                  onClick={() => setShowEditDialog(true)}
                  className="text-cream-700 hover:text-cream-900 shrink-0"
                >
                  <Pencil className="w-[3.5cqw] h-[3.5cqw]" />
                </button>
              )}
            </div>
            {userId && !userId.startsWith('bot_') && (
              <div className="relative shrink-0">
                <button
                  onClick={() => setShowShareMenu(v => !v)}
                  className="w-[8cqw] h-[8cqw] flex items-center justify-center rounded-full bg-cream-100 active:bg-cream-300"
                >
                  <Share2 className="w-[4cqw] h-[4cqw] text-cream-700" />
                </button>
                {showShareMenu && (
                  <>
                    <div className="fixed inset-0 z-[299]" onClick={() => setShowShareMenu(false)} />
                    <div className="absolute right-0 top-full mt-[1cqw] z-[300] bg-white border border-cream-300 rounded-[2cqw] shadow-lg overflow-hidden min-w-[40cqw]">
                      <button
                        onClick={handleCopyLink}
                        className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-900 hover:bg-cream-100 active:bg-cream-200"
                      >
                        {copied ? <Check className="w-[4cqw] h-[4cqw] text-forest" /> : <Link className="w-[4cqw] h-[4cqw]" />}
                        {copied ? 'コピーしました' : 'リンクをコピー'}
                      </button>
                      <button
                        onClick={handleShareX}
                        className="flex items-center gap-[2cqw] w-full px-[3cqw] py-[2.5cqw] text-[3cqw] text-cream-900 hover:bg-cream-100 active:bg-cream-200 border-t border-cream-200"
                      >
                        <svg className="w-[4cqw] h-[4cqw]" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        X でシェア
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Badges */}
          {badges.length > 0 && (
            <div className="relative mb-[2.5cqw]">
              <div className="flex gap-[2cqw]">
                {badges.map((badge) => (
                  <div
                    key={badge.type}
                    className="flex flex-col items-center"
                    onClick={(e) => { e.stopPropagation(); setActiveBadge(v => v === badge.type ? null : badge.type); }}
                  >
                    <div className="relative w-[11cqw] h-[11cqw]">
                      <div className="w-full h-full rounded-full bg-cream-100 border border-cream-300 overflow-hidden">
                        <img src={badge.imageUrl} alt={badge.label} className="w-full h-full object-cover" />
                      </div>
                      {badge.count > 1 && (
                        <span className="absolute -top-[0.5cqw] -right-[1cqw] bg-cream-900 text-white text-[1.8cqw] font-bold rounded-full min-w-[3.5cqw] h-[3.5cqw] flex items-center justify-center px-[0.3cqw]">
                          ×{badge.count}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {activeBadge && (() => {
                const badge = badges.find(b => b.type === activeBadge);
                if (!badge) return null;
                return (
                  <div
                    ref={badgeTooltipRef}
                    className="absolute z-[300] top-full mt-[1cqw] left-0 right-0 bg-cream-900 border border-cream-700 rounded-[2cqw] p-[3cqw] shadow-xl"
                  >
                    <div className="text-white text-[3.8cqw] font-semibold mb-[1cqw]">{badge.label}</div>
                    <div className="text-white/60 text-[3.3cqw] italic mb-[1cqw]">{badge.flavor}</div>
                    <div className="text-white/40 text-[3cqw]">{badge.description}</div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Stats */}
          <div className="bg-cream-100 rounded-[3cqw] p-[3.5cqw]">
            {loading ? (
              <div className="flex flex-col items-center py-[3cqw]">
                <div className="w-[5cqw] h-[5cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
                <p className="text-cream-500 text-[2.5cqw] mt-[1.5cqw]">読み込み中...</p>
              </div>
            ) : stats ? (
              <>
                {/* 収支セクション */}
                <div className="grid grid-cols-3 gap-x-[2cqw] gap-y-[1.5cqw] mb-[2.5cqw]">
                  <StatItem label="総ハンド数" value={stats.handsPlayed.toLocaleString()} />
                  <StatItem label="実収支" value={formatProfit(stats.totalProfit)} color={stats.totalProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate" value={formatRate(stats.winRate)} color={stats.winRate >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <div />
                  <StatItem label="収支 (EV)" value={formatProfit(stats.totalAllInEVProfit ?? stats.totalProfit)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate (EV)" value={formatRate((stats.totalAllInEVProfit ?? stats.totalProfit) / stats.handsPlayed)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                </div>
                {/* ポーカースタッツ */}
                <div className="grid grid-cols-4 gap-x-[1.5cqw] gap-y-[1.5cqw]">
                  <StatItem label="VPIP" value={`${stats.vpip.toFixed(1)}%`} />
                  <StatItem label="PFR" value={`${stats.pfr.toFixed(1)}%`} />
                  <StatItem label="3Bet" value={`${stats.threeBet.toFixed(1)}%`} />
                  <StatItem label="4Bet" value={`${stats.fourBet.toFixed(1)}%`} />
                  <StatItem label="AFq" value={`${stats.afq.toFixed(1)}%`} />
                  <StatItem label="CBet" value={`${stats.cbet.toFixed(1)}%`} />
                  <StatItem label="Fold to CB" value={`${stats.foldToCbet.toFixed(1)}%`} />
                  <StatItem label="Fold to 3B" value={`${stats.foldTo3Bet.toFixed(1)}%`} />
                </div>
              </>
            ) : (
              <div className="grid grid-cols-3 gap-[2cqw]">
                <StatItem label="Hands" value="—" isPlaceholder />
                <StatItem label="Win Rate" value="—" isPlaceholder />
                <StatItem label="VPIP" value="—" isPlaceholder />
                <StatItem label="PFR" value="—" isPlaceholder />
                <StatItem label="3Bet" value="—" isPlaceholder />
                <StatItem label="4Bet" value="—" isPlaceholder />
              </div>
            )}
          </div>

          {/* No Stats Notice */}
          {!loading && !stats && (
            <p className="text-cream-500 text-[2.5cqw] text-center mt-[2cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}

          {/* Profit Chart (self only) */}
          {isSelf && !loading && profitHistory.length >= 2 && (
            <div className="bg-cream-100 rounded-[3cqw] p-[3.5cqw] mt-[2cqw]">
              <ProfitChart points={profitHistory} />
            </div>
          )}

        </div>
      </div>

      {/* Close Button */}
      <div className="@container w-full shrink-0 px-[4cqw] pb-[4cqw] pt-[1cqw]">
        <button
          onClick={onClose}
          className="w-full py-[3cqw] bg-cream-900 text-white text-[4cqw] font-bold rounded-[3cqw] active:bg-cream-800"
        >
          閉じる
        </button>
      </div>

      {/* Edit Dialog */}
      {showEditDialog && (
        <ProfileEditDialog
          currentName={name}
          currentAvatarUrl={avatarUrl ?? null}
          twitterAvatarUrl={twitterAvatarUrl ?? null}
          useTwitterAvatar={useTwitterAvatar}
          onClose={() => setShowEditDialog(false)}
          onSaved={() => {
            setShowEditDialog(false);
            onProfileUpdated?.();
          }}
        />
      )}
    </div>
  );
}

// ============================================
// Helpers
// ============================================

function formatProfit(profit: number): string {
  const sign = profit >= 0 ? '+' : '';
  return `${sign}${profit.toLocaleString()}`;
}

function formatRate(rate: number): string {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}`;
}

const statInfo: Record<string, { desc: string; formula: string }> = {
  '総ハンド数':   { desc: 'プレイしたハンド数', formula: '参加ハンドの合計' },
  '実収支':      { desc: '総損益（チップ）', formula: '全ハンドの獲得チップ合計' },
  'Win Rate':  { desc: '1ハンドあたりの実損益', formula: '実収支 ÷ 総ハンド数' },
  '収支 (EV)': { desc: 'オールイン時のエクイティに基づく期待損益', formula: 'Σ(エクイティ × ポット額 - ベット額)' },
  'Win Rate (EV)': { desc: '1ハンドあたりのEV期待損益', formula: 'EV損益合計 ÷ 総ハンド数' },
  VPIP:        { desc: '自発的にポットに参加した割合', formula: '(コール+レイズ) ÷ 総ハンド数 × 100' },
  PFR:         { desc: 'プリフロップでレイズした割合', formula: 'PFレイズ数 ÷ 総ハンド数 × 100' },
  '3Bet':      { desc: 'プリフロップで3ベットした割合', formula: '3ベット数 ÷ 3ベット機会数 × 100' },
  '4Bet':      { desc: 'プリフロップで4ベットした割合', formula: '4ベット数 ÷ 4ベット機会数 × 100' },
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
      <div className="text-cream-600 text-[2.5cqw] flex items-center justify-center gap-[1cqw] mb-[0.5cqw]">
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
      <div className={`text-[4.5cqw] font-bold ${isPlaceholder ? 'text-cream-400' : color || 'text-cream-900'}`}>
        {value}
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
