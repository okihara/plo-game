import { useEffect, useState, useRef } from 'react';
import { Pencil, Check } from 'lucide-react';
import { ProfitChart } from './ProfitChart';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PRESET_AVATARS = [
  ...Array.from({ length: 70 }, (_, i) => `/images/icons/icon_${String(i + 1).padStart(3, '0')}.png`),
];

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

interface ProfilePopupProps {
  name: string;
  avatarUrl?: string | null;
  avatarId?: number;
  userId?: string;
  badges?: string[];
  isSelf?: boolean;
  onClose: () => void;
  onProfileUpdated?: () => void;
  twitterAvatarUrl?: string | null;
  useTwitterAvatar?: boolean;
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
  onProfileUpdated,
  twitterAvatarUrl,
  useTwitterAvatar = false,
}: ProfilePopupProps) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [profitHistory, setProfitHistory] = useState<{ p: number; c: number; s: number; n: number; e: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
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
          <div className="flex flex-col items-center mb-[3cqw]">
            <div className="w-[16cqw] h-[16cqw] rounded-full bg-gradient-to-br from-cream-200 to-cream-300 border-[0.8cqw] border-cream-300 overflow-hidden mb-[2cqw]">
              {avatarImage ? (
                <img src={avatarImage} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[6cqw]">👤</div>
              )}
            </div>
            <div className="flex items-center gap-[1.5cqw]">
              <h2 className="text-[4cqw] font-bold text-cream-900">{name}</h2>
              {isSelf && (
                <button
                  onClick={() => setShowEditDialog(true)}
                  className="text-cream-700 hover:text-cream-900"
                >
                  <Pencil className="w-[3.5cqw] h-[3.5cqw]" />
                </button>
              )}
            </div>
          </div>

          {/* Badges (実バッジがある場合のみ表示) */}
          {badges.length > 0 && (
            <div className="flex justify-center gap-[2.5cqw] mb-[5cqw]">
              {badges.map((_, i) => (
                <div
                  key={i}
                  className="w-[12cqw] h-[12cqw] rounded-full bg-yellow-500/20 border border-yellow-500/40 flex items-center justify-center text-[5cqw]"
                >
                  🏆
                </div>
              ))}
            </div>
          )}

          {/* Stats */}
          <div className="bg-cream-100 rounded-[4cqw] p-[5cqw]">
            {loading ? (
              <div className="flex flex-col items-center py-[4cqw]">
                <div className="w-[6cqw] h-[6cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
                <p className="text-cream-500 text-[3cqw] mt-[2cqw]">読み込み中...</p>
              </div>
            ) : stats ? (
              <>
                {/* 収支セクション */}
                <div className="grid grid-cols-3 gap-[2.5cqw] mb-[4cqw]">
                  <StatItem label="総ハンド数" value={stats.handsPlayed.toLocaleString()} />
                  <StatItem label="実収支" value={formatProfit(stats.totalProfit)} color={stats.totalProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate" value={formatRate(stats.winRate)} color={stats.winRate >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <div />
                  <StatItem label="収支 (EV)" value={formatProfit(stats.totalAllInEVProfit ?? stats.totalProfit)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                  <StatItem label="Win Rate (EV)" value={formatRate((stats.totalAllInEVProfit ?? stats.totalProfit) / stats.handsPlayed)} color={(stats.totalAllInEVProfit ?? stats.totalProfit) >= 0 ? 'text-forest' : 'text-[#C0392B]'} />
                </div>
                {/* ポーカースタッツ */}
                <div className="grid grid-cols-3 gap-[2.5cqw]">
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
              <div className="grid grid-cols-2 gap-[3cqw]">
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
            <p className="text-cream-500 text-[3cqw] text-center mt-[3cqw]">
              スタッツはハンドをプレイすると表示されます
            </p>
          )}

          {/* Profit Chart (self only) */}
          {isSelf && !loading && profitHistory.length >= 2 && (
            <div className="bg-cream-100 rounded-[4cqw] p-[5cqw] mt-[3cqw]">
              <ProfitChart points={profitHistory} />
            </div>
          )}

        </div>
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
// Profile Edit Dialog
// ============================================

interface ProfileEditDialogProps {
  currentName: string;
  currentAvatarUrl: string | null;
  twitterAvatarUrl: string | null;
  useTwitterAvatar: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function ProfileEditDialog({
  currentName,
  currentAvatarUrl,
  twitterAvatarUrl,
  useTwitterAvatar: initialUseTwitter,
  onClose,
  onSaved,
}: ProfileEditDialogProps) {
  const [editName, setEditName] = useState(currentName);
  const [nameError, setNameError] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(
    initialUseTwitter ? null : currentAvatarUrl
  );
  const [isTwitterSelected, setIsTwitterSelected] = useState(initialUseTwitter);
  const [saving, setSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    const trimmedName = editName.trim();
    if (trimmedName.length < 1 || trimmedName.length > 12) {
      setNameError('1〜12文字で入力してください');
      return;
    }

    setSaving(true);
    setNameError('');

    try {
      const promises: Promise<Response>[] = [];

      // 名前変更
      if (trimmedName !== currentName) {
        promises.push(
          fetch(`${API_BASE}/api/auth/display-name`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ displayName: trimmedName }),
          })
        );
      }

      // アバター変更
      const avatarChanged = isTwitterSelected !== initialUseTwitter ||
        (!isTwitterSelected && selectedAvatar !== currentAvatarUrl);

      if (avatarChanged) {
        promises.push(
          fetch(`${API_BASE}/api/auth/avatar`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              avatarUrl: isTwitterSelected ? (twitterAvatarUrl ?? currentAvatarUrl) : selectedAvatar,
              useTwitterAvatar: isTwitterSelected,
            }),
          })
        );
      }

      if (promises.length === 0) {
        onClose();
        return;
      }

      const results = await Promise.all(promises);
      const failed = results.find(r => !r.ok);
      if (failed) {
        const data = await failed.json().catch(() => null);
        setNameError(data?.error || '保存に失敗しました');
        return;
      }

      onSaved();
    } catch {
      setNameError('通信エラー');
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // 現在のアバターURLがプリセットのどれかを判定
  const twitterPreviewUrl = initialUseTwitter ? currentAvatarUrl : twitterAvatarUrl;

  return (
    <div
      className="absolute inset-0 bg-black/60 flex items-center justify-center z-[250]"
      onClick={handleBackdropClick}
    >
      <div className="@container w-[80cqw] h-full flex items-center justify-center" onClick={handleBackdropClick}>
        <div className="bg-white rounded-[5cqw] p-[6cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.3)] animate-scale-in relative max-h-[80%] flex flex-col">
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-[3cqw] right-[3cqw] text-cream-400 hover:text-cream-900 text-[7cqw] leading-none z-10"
          >
            ×
          </button>

          <h2 className="text-[4.5cqw] font-bold text-cream-900 mb-[4cqw] shrink-0">プロフィール編集</h2>

          {/* Name */}
          <div className="mb-[4cqw] shrink-0">
            <label className="text-cream-600 text-[3cqw] mb-[1.5cqw] block">名前</label>
            <input
              ref={nameInputRef}
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              maxLength={12}
              disabled={saving}
              className="w-full text-[3.5cqw] text-cream-900 bg-cream-100 border border-cream-300 rounded-[2.5cqw] px-[3cqw] py-[2cqw] outline-none focus:border-forest"
            />
            {nameError && (
              <p className="text-[2.5cqw] text-[#C0392B] mt-[1cqw]">{nameError}</p>
            )}
          </div>

          {/* Avatar Selection (scrollable) */}
          <div className="mb-[4cqw] min-h-0 flex flex-col">
            <label className="text-cream-600 text-[3cqw] mb-[2cqw] block shrink-0">アイコン</label>

            <div className="overflow-y-auto min-h-0">
              {/* Twitter Avatar Option */}
              {twitterPreviewUrl && (
                <button
                  onClick={() => { setIsTwitterSelected(true); setSelectedAvatar(null); }}
                  disabled={saving}
                  className={`flex items-center gap-[2.5cqw] w-full mb-[2.5cqw] p-[2cqw] rounded-[3cqw] border-[0.6cqw] transition-colors ${
                    isTwitterSelected
                      ? 'border-forest bg-forest/5'
                      : 'border-cream-300 hover:border-cream-400'
                  }`}
                >
                  <div className="w-[10cqw] h-[10cqw] rounded-full overflow-hidden shrink-0 bg-cream-200">
                    <img src={twitterPreviewUrl} alt="X" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-[3cqw] text-cream-700">Xのアイコンを使用</span>
                  {isTwitterSelected && <Check className="w-[4cqw] h-[4cqw] text-forest ml-auto" />}
                </button>
              )}

              {/* Preset Avatars Grid */}
              <div className="grid grid-cols-5 gap-[2cqw]">
                {PRESET_AVATARS.map((url) => {
                  const isSelected = !isTwitterSelected && selectedAvatar === url;
                  return (
                    <button
                      key={url}
                      onClick={() => { setSelectedAvatar(url); setIsTwitterSelected(false); }}
                      disabled={saving}
                      className={`aspect-square rounded-full overflow-hidden border-[0.6cqw] transition-colors ${
                        isSelected
                          ? 'border-forest ring-[0.5cqw] ring-forest/30'
                          : 'border-cream-300 hover:border-cream-400'
                      }`}
                    >
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-cream-500 text-[2.5cqw] mt-[2cqw] shrink-0">次回着席時から反映</p>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full py-[2.5cqw] bg-cream-900 text-white text-[3.5cqw] font-semibold rounded-[3cqw] hover:bg-cream-800 disabled:opacity-50 transition-colors shrink-0"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
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
