import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ProfilePopup } from '../components/ProfilePopup';

interface SimpleLobbyProps {
  onPlayOnline: (blinds: string) => void;
}

interface TableOption {
  id: string;
  gameType: 'PLO' | 'NLH';
  gameLabel: string;
  blinds: string;
  blindsLabel: string;
  buyIn: number;
  playerCount: number; // TODO: サーバーから取得
}

const TABLE_OPTIONS: TableOption[] = [
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '$1/$3', buyIn: 300, playerCount: 0 },
  { id: 'plo-2-5', gameType: 'PLO', gameLabel: 'PLO', blinds: '2/5', blindsLabel: '$2/$5', buyIn: 500, playerCount: 0 },
  { id: 'plo-5-10', gameType: 'PLO', gameLabel: 'PLO', blinds: '5/10', blindsLabel: '$5/$10', buyIn: 1000, playerCount: 0 },
];

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  const { user, loading, logout } = useAuth();
  const [showProfile, setShowProfile] = useState(false);

  const handleLogin = () => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    window.location.href = `${apiBase}/api/auth/twitter`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4 relative">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Volt Poker Club</h1>
        </div>

        {/* User Info or Login Buttons */}
        {loading ? (
          <div className="text-center text-white/60 mb-6">読み込み中...</div>
        ) : user ? (
          <div className="bg-white/10 backdrop-blur rounded-xl p-4 mb-6 border border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {user.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-10 h-10 rounded-full cursor-pointer hover:ring-2 hover:ring-white/50 transition-all"
                    onClick={() => setShowProfile(true)}
                  />
                )}
                <div>
                  <div className="text-white font-bold">{user.username}</div>
                  <div className="text-cyan-400 text-sm">${user.balance}</div>
                </div>
              </div>
              <button
                onClick={logout}
                className="text-white/60 hover:text-white text-sm"
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur rounded-xl p-6 mb-6 border border-white/10">
            <p className="text-white/80 text-center mb-4">ログインしてプレイ</p>
            <button
              onClick={handleLogin}
              className="w-full py-3 px-4 bg-sky-500 text-white rounded-lg hover:bg-sky-600 transition-all font-medium flex items-center justify-center gap-2"
            >
              <span>🐦</span> Twitterでログイン
            </button>
            <p className="text-white/40 text-xs text-center mt-4">
              またはゲストとしてプレイ
            </p>
          </div>
        )}

        {/* Table selection */}
        <div className="space-y-3">
          {TABLE_OPTIONS.map((table) => (
            <button
              key={table.id}
              onClick={() => onPlayOnline(table.blinds)}
              className="w-full py-4 px-5 bg-white/10 backdrop-blur rounded-xl text-white hover:bg-white/20 transition-all border border-white/10 hover:border-white/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Game type badge */}
                  <span className="px-2 py-1 bg-cyan-500/20 text-cyan-400 text-xs font-bold rounded">
                    {table.gameLabel}
                  </span>
                  {/* Blinds */}
                  <span className="text-lg font-bold">{table.blindsLabel}</span>
                </div>
                <div className="flex items-center gap-4 text-sm text-white/60">
                  {/* Buy-in */}
                  <span>バイイン ${table.buyIn}</span>
                  {/* Player count */}
                  <span className="text-cyan-400">{table.playerCount}人</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Footer info */}
        <div className="mt-8 text-center text-white/40 text-xs">
          <p>NLH, PLO | リアルタイムマルチプレイヤー</p>
        </div>

        {/* Debug link */}
        <div className="mt-4 text-center">
          <a
            href="/debug/player"
            className="text-white/60 hover:text-white/90 text-sm underline"
          >
            🔧 Player Debug
          </a>
        </div>
      </div>

      {/* Profile Popup Container */}
      {showProfile && user && (
        <div className="@container absolute inset-0 w-full h-full">
          <ProfilePopup
            name={user.username}
            avatarUrl={user.avatarUrl}
            onClose={() => setShowProfile(false)}
          />
        </div>
      )}
    </div>
  );
}
