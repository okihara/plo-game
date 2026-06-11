import { useEffect } from 'react';
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
  /** 自分が付けたラベル（表示のみ。編集はフルプロフィールで行う） */
  label?: PlayerLabel;
  onClose: () => void;
  /** フルプロフィールを開く。未指定ならボタン非表示 */
  onShowDetail?: () => void;
}

/**
 * プレイ画面用のコンパクトなプロフィールモーダル。
 * テーブルが背後に見える小モーダルで、外側タップ / ESC で閉じる。
 * 詳細（バッジ・ラベル編集・収支グラフ等）はフルプロフィール（ProfilePopup）へ誘導する。
 */
export function CompactProfileModal({
  name,
  avatarUrl,
  avatarId,
  userId,
  mode = 'cash',
  label,
  onClose,
  onShowDetail,
}: CompactProfileModalProps) {
  const { loading, stats, tournamentStats } = usePlayerStats(userId);
  const displayStats = mode === 'tournament' ? tournamentStats : stats;
  const avatarImage = avatarUrl || (avatarId !== undefined ? getAvatarImage(avatarId) : null);
  const labelColor = label ? LABEL_COLORS.find(c => c.id === label.color)?.hex : undefined;

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
            {labelColor && (
              <span
                className="w-[3cqw] h-[3cqw] rounded-full shrink-0"
                style={{ backgroundColor: labelColor }}
              />
            )}
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

        {/* フルプロフィールへ */}
        {onShowDetail && (
          <button
            onClick={onShowDetail}
            className="mt-[3cqw] w-full py-[2.2cqw] bg-cream-900 text-white text-[3.2cqw] font-bold rounded-[2.5cqw] active:bg-cream-800"
          >
            詳細を見る
          </button>
        )}
      </div>
    </div>
  );
}
