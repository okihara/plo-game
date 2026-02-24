import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface SettingConfigProps {
  onClose: () => void;
}

export function SettingConfig({ onClose }: SettingConfigProps) {
  const { user, refreshUser } = useAuth();
  const [nameMasked, setNameMasked] = useState(user?.nameMasked ?? true);
  const [togglingMask, setTogglingMask] = useState(false);
  const [useTwitterAvatar, setUseTwitterAvatar] = useState(user?.useTwitterAvatar ?? false);
  const [togglingAvatar, setTogglingAvatar] = useState(false);

  // ESCキーで閉じる
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 背景クリックで閉じる
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="absolute inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[200]"
      onClick={handleBackdropClick}
    >
      <div className="@container w-[80cqw]">
        <div className="bg-white rounded-[5cqw] p-[6cqw] border border-cream-300 shadow-[0_8px_40px_rgba(139,126,106,0.2)] animate-scale-in relative">
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute top-[3cqw] right-[3cqw] text-cream-400 hover:text-cream-900 text-[7cqw] leading-none"
          >
            ×
          </button>

          <h2 className="text-[5.5cqw] font-bold text-cream-900 mb-[5cqw]">設定</h2>

          <div className="space-y-[2cqw]">
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
        </div>
      </div>
    </div>
  );
}
