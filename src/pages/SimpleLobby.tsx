import { useState, useEffect } from 'react';
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
  enabled: boolean;
}

const TABLE_OPTIONS: TableOption[] = [
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, enabled: true },
  { id: 'plo-2-5', gameType: 'PLO', gameLabel: 'PLO', blinds: '2/5', blindsLabel: '2/5', buyIn: 500, enabled: false },
  { id: 'plo-5-10', gameType: 'PLO', gameLabel: 'PLO', blinds: '5/10', blindsLabel: '5/10', buyIn: 1000, enabled: false },
];

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  const { user, loading, logout, refreshUser } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [addingChips, setAddingChips] = useState(false);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    const fetchCounts = async () => {
      try {
        const res = await fetch(`${apiBase}/api/lobby/tables`);
        if (res.ok) {
          const data: { blinds: string; playerCount: number }[] = await res.json();
          const counts: Record<string, number> = {};
          for (const d of data) counts[d.blinds] = d.playerCount;
          setPlayerCounts(counts);
        }
      } catch { /* ignore */ }
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleClaimLoginBonus = async () => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    setClaimingBonus(true);
    try {
      const res = await fetch(`${apiBase}/api/bankroll/login-bonus`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        await refreshUser();
      }
    } catch (err) {
      console.error('Failed to claim login bonus:', err);
    } finally {
      setClaimingBonus(false);
    }
  };

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
    <div className="h-full bg-white flex items-center justify-center p-[4cqw] relative overflow-y-auto">
      <div className="w-[90%]">
        {/* Logo */}
        <div className="text-center mb-[6cqw]">
          <img src="/images/image.png" alt="Baby PLO" className="w-[50cqw] mx-auto mb-[3cqw]" />
          <h1 className="text-[8cqw] font-bold text-black tracking-tight mb-[1.5cqw]">Baby PLO</h1>
          <div className="w-[12cqw] h-[0.5cqw] bg-black mx-auto" />
        </div>

        {/* User Info or Login Buttons */}
        {loading ? (
          <div className="text-center text-black/40 text-[3.5cqw] mb-[5cqw]">読み込み中...</div>
        ) : user ? (
          <div className="rounded-[2.5cqw] p-[3.5cqw] mb-[5cqw] border border-black/20 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-[2.5cqw]">
                {user.avatarUrl && (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="w-[10cqw] h-[10cqw] rounded-full cursor-pointer hover:ring-2 hover:ring-black/20 transition-all shadow-sm"
                    onClick={() => setShowProfile(true)}
                  />
                )}
                <div>
                  <div className="text-[4cqw] text-black font-bold">{user.username}</div>
                  <div className="text-[3cqw] text-black/60 flex items-center gap-[1.5cqw]">
                    <span>{user.balance}</span>
                    <button
                      onClick={handleClaimLoginBonus}
                      disabled={claimingBonus || !user.loginBonusAvailable}
                      className="px-[1.5cqw] py-[0.3cqw] text-[2.5cqw] bg-black text-white font-bold rounded-[1cqw] hover:bg-black/80 disabled:opacity-50"
                    >
                      {claimingBonus ? '...' : user.loginBonusAvailable ? '600まで補填' : '受取済み'}
                    </button>
                    {import.meta.env.DEV && (
                      <button
                        onClick={handleDebugAddChips}
                        disabled={addingChips}
                        className="px-[1.5cqw] py-[0.3cqw] text-[2.5cqw] bg-black/10 text-black font-bold rounded-[1cqw] hover:bg-black/20 disabled:opacity-50"
                      >
                        +10,000
                      </button>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={logout}
                className="text-[3cqw] text-black/40 hover:text-black"
              >
                ログアウト
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-[2.5cqw] p-[5cqw] mb-[5cqw] border border-black/20">
            <p className="text-[3.5cqw] text-black/60 text-center mb-[3cqw]">ログインしてプレイ</p>
            <button
              onClick={handleLogin}
              className="w-full py-[2.5cqw] px-[3.5cqw] text-[3.5cqw] bg-black text-white rounded-[2cqw] hover:bg-black/80 transition-all font-medium flex items-center justify-center gap-[2cqw] shadow-md"
            >
              Twitterでログイン
            </button>
            <p className="text-[2.5cqw] text-black/30 text-center mt-[3cqw]">
              またはゲストとしてプレイ
            </p>
          </div>
        )}

        {/* ハンド履歴リンク（ログイン時のみ） */}
        {user && (
          <div className="mb-[4cqw]">
            <button
              onClick={() => {
                window.history.pushState({}, '', '/history');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="w-full py-[2.5cqw] px-[4cqw] text-[3cqw] rounded-[2.5cqw] text-black/50 hover:bg-black/5 hover:text-black transition-all border border-black/15 hover:border-black/30"
            >
              ハンド履歴を見る
            </button>
          </div>
        )}

        {/* Table selection */}
        <div className="mb-[2.5cqw]">
          <h2 className="text-[4cqw] font-bold text-black tracking-tight">Tables</h2>
          <div className="w-[8cqw] h-[0.4cqw] bg-black mt-[0.8cqw]" />
        </div>
        <div className="space-y-[2.5cqw]">
          {TABLE_OPTIONS.map((table) => {
            const count = playerCounts[table.blinds] ?? 0;
            return (
              <button
                key={table.id}
                onClick={() => table.enabled && onPlayOnline(table.blinds)}
                disabled={!table.enabled}
                className={`w-full py-[3.5cqw] px-[4cqw] rounded-[2.5cqw] transition-all border shadow-sm ${
                  table.enabled
                    ? 'text-black hover:bg-black/[0.03] border-black/20 hover:border-black/40 hover:shadow-md'
                    : 'text-black/30 border-black/10 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-[3cqw]">
                    <span className={`px-[2cqw] py-[0.8cqw] text-[2.5cqw] font-bold rounded-[1cqw] ${
                      table.enabled ? 'bg-black text-white' : 'bg-black/20 text-black/40'
                    }`}>
                      {table.gameLabel}
                    </span>
                    <span className="text-[5cqw] font-bold">{table.blindsLabel}</span>
                  </div>
                  <div className="flex items-center gap-[3cqw] text-[3cqw]">
                    <span className={table.enabled ? 'text-black/50' : 'text-black/25'}>buy-in: {table.buyIn}</span>
                    {table.enabled ? (
                      <span className="text-black/70">{count}人</span>
                    ) : (
                      <span className="text-[2.5cqw] text-black/30">準備中</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="mt-[6cqw] text-center text-black/30 text-[2.5cqw]">
          <p>Powered by <a href="https://x.com/okkichan3" className="text-black/70 hover:text-black underline">@okkichan3</a></p>
        </div>

        {/* Debug link */}
        <div className="mt-[3cqw] text-center">
          <a
            href="/debug/player"
            className="text-[3cqw] text-black/40 hover:text-black/70 underline"
          >
            Debug: Player Component
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
