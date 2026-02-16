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
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, playerCount: 0 },
  { id: 'plo-2-5', gameType: 'PLO', gameLabel: 'PLO', blinds: '2/5', blindsLabel: '2/5', buyIn: 500, playerCount: 0 },
  { id: 'plo-5-10', gameType: 'PLO', gameLabel: 'PLO', blinds: '5/10', blindsLabel: '5/10', buyIn: 1000, playerCount: 0 },
];

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  const { user, loading, logout, refreshUser } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [addingChips, setAddingChips] = useState(false);

  const handleDebugAddChips = async () => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    setAddingChips(true);
    try {
      const res = await fetch(`${apiBase}/api/bankroll/debug-add`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await refreshUser();
      }
    } catch (err) {
      console.error('Failed to add debug chips:', err);
    } finally {
      setAddingChips(false);
    }
  };

  const handleLogin = () => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    window.location.href = `${apiBase}/api/auth/twitter`;
  };

  return (
    <div className="h-full bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-[4cqw] relative overflow-y-auto">
      <div className="w-[90%]">
        {/* Logo */}
        <div className="text-center mb-[6cqw]">
          <h1 className="text-[7cqw] font-bold text-white mb-[1.5cqw]">Volt Poker Club</h1>
        </div>

        {/* User Info or Login Buttons */}
        {loading ? (
          <div className="text-center text-white/60 text-[3.5cqw] mb-[5cqw]">読み込み中...</div>
        ) : user ? (
          <div className="bg-white/10 backdrop-blur rounded-[2.5cqw] p-[3.5cqw] mb-[5cqw] border border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[2.5cqw]">
                {user.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-[10cqw] h-[10cqw] rounded-full cursor-pointer hover:ring-2 hover:ring-white/50 transition-all"
                    onClick={() => setShowProfile(true)}
                  />
                )}
                <div>
                  <div className="text-[3.5cqw] text-white font-bold">{user.username}</div>
                  <div className="text-[3cqw] text-cyan-400 flex items-center gap-[1.5cqw]">
                    <span>{user.balance}</span>
                    {import.meta.env.DEV && (
                      <button
                        onClick={handleDebugAddChips}
                        disabled={addingChips}
                        className="px-[1.5cqw] py-[0.3cqw] text-[2.5cqw] bg-yellow-500/80 text-black font-bold rounded-[1cqw] hover:bg-yellow-400 disabled:opacity-50"
                      >
                        +10,000
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={logout}
                className="text-[3cqw] text-white/60 hover:text-white"
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white/10 backdrop-blur rounded-[2.5cqw] p-[5cqw] mb-[5cqw] border border-white/10">
            <p className="text-[3.5cqw] text-white/80 text-center mb-[3cqw]">ログインしてプレイ</p>
            <button
              onClick={handleLogin}
              className="w-full py-[2.5cqw] px-[3.5cqw] text-[3.5cqw] bg-sky-500 text-white rounded-[2cqw] hover:bg-sky-600 transition-all font-medium flex items-center justify-center gap-[2cqw]"
            >
              <span>🐦</span> Twitterでログイン
            </button>
            <p className="text-[2.5cqw] text-white/40 text-center mt-[3cqw]">
              またはゲストとしてプレイ
            </p>
          </div>
        )}

        {/* Table selection */}
        <div className="space-y-[2.5cqw]">
          {TABLE_OPTIONS.map((table) => (
            <button
              key={table.id}
              onClick={() => onPlayOnline(table.blinds)}
              className="w-full py-[3.5cqw] px-[4cqw] bg-white/10 backdrop-blur rounded-[2.5cqw] text-white hover:bg-white/20 transition-all border border-white/10 hover:border-white/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[3cqw]">
                  {/* Game type badge */}
                  <span className="px-[2cqw] py-[0.8cqw] bg-cyan-500/20 text-cyan-400 text-[2.5cqw] font-bold rounded-[1cqw]">
                    {table.gameLabel}
                  </span>
                  {/* Blinds */}
                  <span className="text-[4.5cqw] font-bold">{table.blindsLabel}</span>
                </div>
                <div className="flex items-center gap-[3cqw] text-[3cqw] text-white/60">
                  {/* Buy-in */}
                  <span>バイイン {table.buyIn}</span>
                  {/* Player count */}
                  <span className="text-cyan-400">{table.playerCount}人</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* ハンド履歴リンク（ログイン時のみ） */}
        {user && (
          <div className="mt-[3cqw]">
            <button
              onClick={() => {
                window.history.pushState({}, '', '/history');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="w-full py-[2.5cqw] px-[4cqw] text-[3cqw] bg-white/5 backdrop-blur rounded-[2.5cqw] text-white/70 hover:bg-white/10 hover:text-white transition-all border border-white/5 hover:border-white/15"
            >
              ハンド履歴を見る
            </button>
          </div>
        )}

        {/* Footer info */}
        <div className="mt-[6cqw] text-center text-white/40 text-[2.5cqw]">
          <p>NLH, PLO | リアルタイムマルチプレイヤー</p>
        </div>

        {/* Debug link */}
        <div className="mt-[3cqw] text-center">
          <a
            href="/debug/player"
            className="text-[3cqw] text-white/60 hover:text-white/90 underline"
          >
            🔧 Player Debug
          </a>
        </div>
      </div>

      {/* Profile Popup */}
      {showProfile && user && (
        <ProfilePopup
          name={user.username}
          avatarUrl={user.avatarUrl}
          userId={user.id}
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}
