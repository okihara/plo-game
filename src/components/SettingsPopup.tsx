import { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { getVolumeLevel, setVolumeLevel, type VolumeLevel } from '../services/actionSound';

interface SettingsPopupProps {
  onClose: () => void;
  showLogout?: boolean;
}

const VOLUME_LABELS: Record<VolumeLevel, string> = { 0: 'OFF', 1: '小', 2: '中', 3: '大' };

export function SettingsPopup({ onClose, showLogout = true }: SettingsPopupProps) {
  const { user, logout } = useAuth();
  const { settings, setUseBBNotation, setShowHandName, setAnalysisEnabled } = useGameSettings();
  const [volume, setVolume] = useState<VolumeLevel>(getVolumeLevel());

  const handleVolumeChange = (level: VolumeLevel) => {
    setVolumeLevel(level);
    setVolume(level);
  };

  return (
    <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-[85cqw] bg-white rounded-[4cqw] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-[4cqw] py-[3cqw] border-b border-cream-200 flex items-center justify-between">
          <h2 className="text-[4cqw] font-bold text-cream-900">設定</h2>
          <button
            onClick={onClose}
            className="text-[5cqw] text-cream-700 hover:text-cream-900 leading-none"
          >
            &times;
          </button>
        </div>

        {/* Settings List */}
        <div className="px-[4cqw] py-[3cqw] space-y-[3cqw]">
          {/* Volume */}
          <div>
            <div className="flex items-center gap-[1.5cqw] mb-[1.5cqw]">
              <Volume2 className="w-[3.5cqw] h-[3.5cqw] text-cream-700" />
              <p className="text-[3.2cqw] font-bold text-cream-900">サウンド</p>
              <span className="text-[2.5cqw] text-cream-700 ml-auto">{VOLUME_LABELS[volume]}</span>
            </div>
            <div className="flex gap-[1.5cqw]">
              {([0, 1, 2, 3] as VolumeLevel[]).map(level => (
                <button
                  key={level}
                  onClick={() => handleVolumeChange(level)}
                  className={`flex-1 h-[6cqw] rounded-[1.5cqw] text-[2.8cqw] font-bold transition-all ${
                    volume === level
                      ? 'bg-forest text-white'
                      : 'bg-cream-100 text-cream-700 hover:bg-cream-200'
                  }`}
                >
                  {VOLUME_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          {/* BB Notation */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[3.2cqw] font-bold text-cream-900">BB表記</p>
              <p className="text-[2.5cqw] text-cream-700">チップをBB単位で表示</p>
            </div>
            <button
              onClick={() => setUseBBNotation(!settings.useBBNotation)}
              className={`w-[11cqw] h-[6cqw] rounded-full transition-colors relative ${
                settings.useBBNotation ? 'bg-forest' : 'bg-cream-300'
              }`}
            >
              <div className={`absolute top-[0.5cqw] w-[5cqw] h-[5cqw] bg-white rounded-full shadow transition-transform ${
                settings.useBBNotation ? 'translate-x-[5.5cqw]' : 'translate-x-[0.5cqw]'
              }`} />
            </button>
          </div>

          {/* Hand Name */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[3.2cqw] font-bold text-cream-900">役名表示</p>
              <p className="text-[2.5cqw] text-cream-700">プレイ中に役名を表示</p>
            </div>
            <button
              onClick={() => setShowHandName(!settings.showHandName)}
              className={`w-[11cqw] h-[6cqw] rounded-full transition-colors relative ${
                settings.showHandName ? 'bg-forest' : 'bg-cream-300'
              }`}
            >
              <div className={`absolute top-[0.5cqw] w-[5cqw] h-[5cqw] bg-white rounded-full shadow transition-transform ${
                settings.showHandName ? 'translate-x-[5.5cqw]' : 'translate-x-[0.5cqw]'
              }`} />
            </button>
          </div>

          {/* Analysis */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[3.2cqw] font-bold text-cream-900">オープンハンド評価</p>
              <p className="text-[2.5cqw] text-cream-700">プリフロップでハンドの強さを表示</p>
            </div>
            <button
              onClick={() => setAnalysisEnabled(!settings.analysisEnabled)}
              className={`w-[11cqw] h-[6cqw] rounded-full transition-colors relative ${
                settings.analysisEnabled ? 'bg-forest' : 'bg-cream-300'
              }`}
            >
              <div className={`absolute top-[0.5cqw] w-[5cqw] h-[5cqw] bg-white rounded-full shadow transition-transform ${
                settings.analysisEnabled ? 'translate-x-[5.5cqw]' : 'translate-x-[0.5cqw]'
              }`} />
            </button>
          </div>

          {/* Logout */}
          {showLogout && user && (
            <div className="pt-[2cqw] border-t border-cream-200">
              <button
                onClick={() => { logout(); onClose(); }}
                className="w-full py-[2.5cqw] text-[3.2cqw] text-[#C0392B] font-bold rounded-[2cqw] border border-cream-300 hover:bg-cream-50 active:scale-[0.97] transition-all"
              >
                ログアウト
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
