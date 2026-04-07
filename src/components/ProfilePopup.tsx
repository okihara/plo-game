import { useEffect, useState, useRef } from 'react';
import { Pencil, Share2, Link, Check, X } from 'lucide-react';
import { ProfitChart } from './ProfitChart';
import { ProfileEditDialog } from './ProfileEditDialog';
import { PlayerStatsPanel, type PlayerStatsDisplay } from './PlayerStatsPanel';
import { buildStatsShareText, openXShare } from '../utils/share';
import { LABEL_COLORS, type PlayerLabel } from '../hooks/usePlayerLabels';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

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
  onClose?: () => void;
  onProfileUpdated?: () => void;
  twitterAvatarUrl?: string | null;
  useTwitterAvatar?: boolean;
  initialShowEdit?: boolean;
  label?: PlayerLabel;
  onLabelChange?: (targetUserId: string, color: string, note: string) => void;
  onLabelRemove?: (targetUserId: string) => void;
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
  label,
  onLabelChange,
  onLabelRemove,
}: ProfilePopupProps) {
  const [stats, setStats] = useState<PlayerStatsDisplay | null>(null);
  const [badges, setBadges] = useState<DisplayBadge[]>([]);
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const badgeTooltipRef = useRef<HTMLDivElement>(null);
  const [profitHistory, setProfitHistory] = useState<{ p: number; c: number; s: number; n: number; e: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(initialShowEdit);
  const [copied, setCopied] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [labelNote, setLabelNote] = useState(label?.note ?? '');

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
    openXShare(buildStatsShareText(name), shareUrl);
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
    if (!onClose) return;
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
      className="absolute inset-0 bg-cream-200 z-[200] flex flex-col min-h-0"
    >
      <div className="@container w-full flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className={`px-[4cqw] pt-[3cqw] ${onClose ? 'pb-[1.5cqw]' : 'pb-[18cqw]'} relative`}>

          {/* Avatar + Name */}
          <div className="flex items-center gap-[3cqw] mb-[3cqw]">
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
              {!isSelf && userId && !userId.startsWith('bot_') && onLabelChange && (
                <div className="flex items-center gap-[1cqw] shrink-0 ml-auto">
                  {LABEL_COLORS.map(c => {
                    const isSelected = label?.color === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          if (isSelected) {
                            onLabelRemove?.(userId);
                            setLabelNote('');
                          } else {
                            onLabelChange(userId, c.id, labelNote);
                          }
                        }}
                        className={`w-[5cqw] h-[5cqw] rounded-full border-[0.5cqw] transition-transform ${isSelected ? 'scale-125 border-cream-900' : 'border-transparent active:scale-110'}`}
                        style={{ backgroundColor: c.hex }}
                      />
                    );
                  })}
                </div>
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

          {/* Label Note */}
          {!isSelf && userId && label && onLabelChange && (
            <div className="mb-[3cqw] flex gap-[1.5cqw]">
              <input
                type="text"
                value={labelNote}
                onChange={e => setLabelNote(e.target.value)}
                onBlur={() => onLabelChange(userId, label.color, labelNote)}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); } }}
                placeholder="メモを入力..."
                className="flex-1 text-[3cqw] px-[2cqw] py-[1.5cqw] border border-cream-300 rounded-[2cqw] bg-cream-50 text-cream-900 placeholder:text-cream-400 outline-none focus:border-cream-500"
              />
              <button
                onClick={() => { onLabelRemove?.(userId); setLabelNote(''); }}
                className="text-cream-500 active:text-cream-700 px-[1cqw]"
              >
                <X className="w-[4cqw] h-[4cqw]" />
              </button>
            </div>
          )}

          {/* Badges */}
          {badges.length > 0 && (
            <div className="relative mb-[3cqw] bg-white rounded-[3cqw] p-[2.5cqw] border border-cream-200/90 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
              <div className="flex gap-[2cqw]">
                {badges.map((badge) => (
                  <div
                    key={badge.type}
                    className="flex flex-col items-center"
                    onClick={(e) => { e.stopPropagation(); setActiveBadge(v => v === badge.type ? null : badge.type); }}
                  >
                    <div className="relative w-[11cqw] h-[11cqw]">
                      <div className="w-full h-full rounded-full bg-white border border-cream-300 overflow-hidden">
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
                    <div className="text-white text-[3.3cqw] italic mb-[1cqw] opacity-95">{badge.flavor}</div>
                    <div className="text-white text-[3cqw]">{badge.description}</div>
                  </div>
                );
              })()}
            </div>
          )}

          <PlayerStatsPanel
            loading={loading}
            stats={stats}
            showPlaceholderWhenEmpty
          />

          {/* No Stats Notice */}
          {!loading && !stats && (
            <p className="text-cream-800 text-[2.5cqw] text-center mt-[1cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}

          {/* Profit Chart (self only) */}
          {isSelf && !loading && profitHistory.length >= 2 && (
            <div className="bg-white rounded-[3cqw] p-[2.5cqw] mt-[3cqw] border border-cream-200/90 shadow-[0_2px_8px_rgba(139,126,106,0.12)]">
              <ProfitChart points={profitHistory} />
            </div>
          )}

        </div>
      </div>

      {/* Close Button */}
      {onClose && (
        <div className="@container w-full shrink-0 px-[4cqw] pb-[4cqw] pt-[1cqw]">
          <button
            onClick={onClose}
            className="w-full py-[3cqw] bg-cream-900 text-white text-[4cqw] font-bold rounded-[3cqw] active:bg-cream-800"
          >
            閉じる
          </button>
        </div>
      )}

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
