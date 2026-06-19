import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { usePlayerStats } from '../hooks/usePlayerStats';
import { getAvatarImage } from './ProfilePopup';
import { LABEL_COLORS, type PlayerLabel } from '../hooks/usePlayerLabels';

interface CompactProfileModalProps {
  name: string;
  avatarUrl?: string | null;
  avatarId?: number;
  userId?: string;
  /** 'tournament' のときトナメスタッツを表示 */
  mode?: 'cash' | 'tournament';
  /** 自分自身のプロフィールならラベル編集を出さない */
  isSelf?: boolean;
  /** 自分が付けたラベル */
  label?: PlayerLabel;
  onClose: () => void;
  /** ラベル（色・メモ）の保存。未指定なら編集UIを出さない */
  onLabelChange?: (targetUserId: string, color: string, note: string) => void;
  onLabelRemove?: (targetUserId: string) => void;
}

/**
 * プレイ画面用のコンパクトなプロフィールモーダル。
 * テーブルが背後に見える小モーダルで、外側タップ / ESC で閉じる。
 * 主要スタッツ・バッジを表示し、相手プレイヤーには色ラベルとメモを付けられる。
 */
export function CompactProfileModal({
  name,
  avatarUrl,
  avatarId,
  userId,
  mode = 'cash',
  isSelf = false,
  label,
  onClose,
  onLabelChange,
  onLabelRemove,
}: CompactProfileModalProps) {
  const { loading, stats, tournamentStats, badges } = usePlayerStats(userId);
  const displayStats = mode === 'tournament' ? tournamentStats : stats;
  const avatarImage = avatarUrl || (avatarId !== undefined ? getAvatarImage(avatarId) : null);

  const [labelNote, setLabelNote] = useState(label?.note ?? '');
  const [activeBadge, setActiveBadge] = useState<string | null>(null);
  const badgeTooltipRef = useRef<HTMLDivElement>(null);

  const canLabel =
    !isSelf && !!userId && !userId.startsWith('bot_') && !!onLabelChange;

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  const items: { label: string; value: string }[] = [
    { label: 'ハンド数', value: displayStats ? displayStats.handsPlayed.toLocaleString() : '—' },
    { label: 'VPIP', value: displayStats ? `${displayStats.vpip.toFixed(1)}%` : '—' },
    { label: 'PFR', value: displayStats ? `${displayStats.pfr.toFixed(1)}%` : '—' },
    { label: '3Bet', value: displayStats ? `${displayStats.threeBet.toFixed(1)}%` : '—' },
    { label: 'AFq', value: displayStats ? `${displayStats.afq.toFixed(1)}%` : '—' },
    { label: 'CBet', value: displayStats ? `${displayStats.cbet.toFixed(1)}%` : '—' },
  ];

  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      {/* スクリム（テーブルが背後に見える） */}
      <div className="absolute inset-0 bg-black/40" />

      <div
        className="relative w-[78cqw] bg-cream-100 border border-cream-300 rounded-[4cqw] shadow-2xl p-[4cqw] animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        {/* 閉じるボタン */}
        <button
          onClick={onClose}
          className="absolute top-[2cqw] right-[2cqw] w-[7cqw] h-[7cqw] flex items-center justify-center rounded-full text-cream-700 active:bg-cream-300"
          aria-label="閉じる"
        >
          <X className="w-[4.5cqw] h-[4.5cqw]" />
        </button>

        {/* アバター + 名前 */}
        <div className="flex items-center gap-[3cqw] mb-[3cqw] pr-[7cqw]">
          <div className="w-[13cqw] h-[13cqw] rounded-full bg-gradient-to-br from-cream-200 to-cream-300 border-[0.6cqw] border-cream-300 overflow-hidden shrink-0">
            {avatarImage ? (
              <img src={avatarImage} alt={name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[5cqw]">👤</div>
            )}
          </div>
          <div className="flex items-center gap-[1.5cqw] min-w-0">
            <h2 className="text-[4.2cqw] font-bold text-cream-900 truncate">{name}</h2>
          </div>
        </div>

        {/* 主要スタッツ */}
        {loading ? (
          <div className="flex flex-col items-center py-[4cqw]">
            <div className="w-[5cqw] h-[5cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
            <p className="text-cream-800 text-[2.5cqw] mt-[1.2cqw]">読み込み中...</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-[1.5cqw]">
            {items.map(item => (
              <div
                key={item.label}
                className="bg-white rounded-[2cqw] border border-cream-200/90 px-[1.5cqw] py-[1.5cqw] flex flex-col items-center gap-[0.6cqw]"
              >
                <span className="text-[2.4cqw] text-cream-800 font-medium leading-none">{item.label}</span>
                <span className="text-[3.4cqw] font-bold text-cream-900 tabular-nums leading-none">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* バッジ */}
        {!loading && badges.length > 0 && (
          <div className="relative mt-[3cqw] bg-white rounded-[2.5cqw] p-[2cqw] border border-cream-200/90">
            <div className="flex flex-wrap gap-[2cqw]">
              {badges.map(badge => (
                <div
                  key={badge.type}
                  className="flex flex-col items-center"
                  onClick={e => { e.stopPropagation(); setActiveBadge(v => v === badge.type ? null : badge.type); }}
                >
                  <div className="relative w-[10cqw] h-[10cqw]">
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

        {/* 色ラベル + メモ（相手プレイヤーのみ） */}
        {canLabel && userId && (
          <div className="mt-[3cqw]">
            <div className="flex items-center justify-center gap-[2cqw] mb-[2cqw]">
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
                        onLabelChange?.(userId, c.id, labelNote);
                      }
                    }}
                    className={`w-[5.5cqw] h-[5.5cqw] rounded-full border-[0.5cqw] transition-transform ${isSelected ? 'scale-125 border-cream-900' : 'border-transparent active:scale-110'}`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
            <div className="flex gap-[1.5cqw] items-start">
              <textarea
                value={labelNote}
                onChange={e => setLabelNote(e.target.value)}
                onBlur={() => {
                  // 既存ラベルがあれば常に更新。無ければメモが空でない時だけ既定色で作成。
                  if (label) onLabelChange?.(userId, label.color, labelNote);
                  else if (labelNote.trim()) onLabelChange?.(userId, 'gray', labelNote);
                }}
                rows={3}
                placeholder="メモを入力..."
                className="flex-1 resize-none text-[3.4cqw] leading-[1.5] px-[2.5cqw] py-[2cqw] border border-cream-300 rounded-[2cqw] bg-cream-50 text-cream-900 placeholder:text-cream-400 outline-none focus:border-cream-500"
              />
              {label && (
                <button
                  onClick={() => { onLabelRemove?.(userId); setLabelNote(''); }}
                  className="text-cream-500 active:text-cream-700 px-[1cqw] py-[2cqw]"
                  aria-label="ラベルを削除"
                >
                  <X className="w-[4cqw] h-[4cqw]" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
