import { useState, useRef } from 'react';
import { Check } from 'lucide-react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';
const PRESET_AVATARS = [
  ...Array.from({ length: 70 }, (_, i) => `/images/icons/icon_${String(i + 1).padStart(3, '0')}.png`),
];

export interface ProfileEditDialogProps {
  currentName: string;
  currentAvatarUrl: string | null;
  twitterAvatarUrl: string | null;
  useTwitterAvatar: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ProfileEditDialog({
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
