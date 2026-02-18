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
    <div className="h-full w-full glass-bg relative overflow-y-auto">
      <div className="relative z-10 flex flex-col items-center px-[5cqw] py-[6cqw]">
        {/* Logo */}
        <div className="text-center mb-[5cqw]">
          {/* <img
            src="/images/image.png"
            alt="Baby PLO"
            className="w-[40cqw] mx-auto mb-[2cqw] drop-shadow-[0_0_20px_rgba(16,185,129,0.3)]"
          /> */}
          <h1 className="text-[8cqw] font-bold text-white tracking-tight">Baby PLO</h1>
        </div>

        {/* User Info or Login */}
        <div className="w-[90%]">
          {loading ? (
            <div className="text-center text-white/40 text-[3.5cqw] mb-[5cqw]">読み込み中...</div>
          ) : user ? (
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-[4cqw] p-[4cqw] mb-[4cqw] shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[2.5cqw]">
                  {user.avatarUrl && (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-[12cqw] h-[12cqw] rounded-full border-[0.4cqw] border-white/20 cursor-pointer hover:border-emerald-400/50 transition-all"
                      onClick={() => setShowProfile(true)}
                    />
                  )}
                  <div>
                    <div className="text-[4cqw] text-white font-bold">{user.username}</div>
                    <div className="flex items-center gap-[1.5cqw] mt-[0.5cqw]">
                      <span className="text-[3.5cqw] font-bold text-emerald-400">{user.balance}</span>
                      <button
                        onClick={handleClaimLoginBonus}
                        disabled={claimingBonus || !user.loginBonusAvailable}
                        className="px-[1.5cqw] py-[0.5cqw] text-[2.2cqw] bg-emerald-500/20 text-emerald-400 font-bold rounded-[1cqw] hover:bg-emerald-500/30 disabled:opacity-40 transition-all"
                      >
                        {claimingBonus ? '...' : user.loginBonusAvailable ? '600まで補填' : '受取済み'}
                      </button>
                      {import.meta.env.DEV && (
                        <button
                          onClick={handleDebugAddChips}
                          disabled={addingChips}
                          className="px-[1.5cqw] py-[0.5cqw] text-[2.2cqw] bg-white/[0.08] text-white/50 font-bold rounded-[1cqw] hover:bg-white/[0.15] disabled:opacity-40 transition-all"
                        >
                          +10,000
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="text-[2.8cqw] text-white/30 hover:text-white/60 transition-colors"
                >
                  ログアウト
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white/[0.07] backdrop-blur-xl border border-white/[0.12] rounded-[4cqw] p-[5cqw] mb-[4cqw] shadow-[0_4px_24px_rgba(0,0,0,0.3)]">
              <p className="text-[3.5cqw] text-white/50 text-center mb-[3cqw]">ログインしてプレイ</p>
              <button
                onClick={handleLogin}
                className="w-full py-[2.5cqw] px-[4cqw] text-[3.5cqw] bg-emerald-500 text-white rounded-[2cqw] hover:bg-emerald-400 transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_4px_20px_rgba(16,185,129,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_28px_rgba(16,185,129,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_10px_rgba(16,185,129,0.3)]"
              >
                Twitterでログイン
              </button>
              <p className="text-[2.5cqw] text-white/25 text-center mt-[3cqw]">
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
                className="w-full py-[2.5cqw] px-[4cqw] text-[3cqw] text-white/50 hover:text-white/80 bg-white/[0.05] hover:bg-white/[0.1] rounded-[2.5cqw] transition-all border border-white/[0.1] hover:border-white/[0.2] flex items-center justify-between"
              >
                <span>ハンド履歴を見る</span>
                <span className="text-white/30 text-[3.5cqw]">&rsaquo;</span>
              </button>
            </div>
          )}

          {/* Tables */}
          <div className="mb-[2.5cqw]">
            <h2 className="text-[4cqw] font-semibold text-white/80 tracking-wide uppercase">Tables</h2>
          </div>
          <div className="space-y-[2.5cqw]">
            {TABLE_OPTIONS.map((table) => {
              const count = playerCounts[table.blinds] ?? 0;
              return (
                <button
                  key={table.id}
                  onClick={() => table.enabled && onPlayOnline(table.blinds)}
                  disabled={!table.enabled}
                  className={`w-full py-[3.5cqw] px-[4cqw] rounded-[3cqw] transition-all duration-200 border backdrop-blur-xl ${
                    table.enabled
                      ? 'bg-white/[0.1] border-white/[0.18] shadow-[0_4px_24px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] hover:bg-white/[0.15] hover:border-white/[0.25] hover:shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.98] active:shadow-[0_2px_12px_rgba(0,0,0,0.3)]'
                      : 'bg-white/[0.03] border-white/[0.06] opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[3cqw]">
                      <span className={`px-[2cqw] py-[0.6cqw] text-[2.5cqw] font-bold rounded-[1cqw] ${
                        table.enabled
                          ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/20'
                          : 'bg-white/[0.05] text-white/30'
                      }`}>
                        {table.gameLabel}
                      </span>
                      <span className="text-[5cqw] font-bold text-white">{table.blindsLabel}</span>
                    </div>
                    <div className="flex items-center gap-[2cqw] text-[2.8cqw]">
                      <span className="text-white/40">buy-in: {table.buyIn}</span>
                      {table.enabled ? (
                        <>
                          <span className="text-emerald-400/80">{count}人</span>
                          <span className="text-white/25 text-[4cqw]">&rsaquo;</span>
                        </>
                      ) : (
                        <span className="text-white/25">準備中</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-[6cqw] text-center text-white/25 text-[2.5cqw]">
            <p>Powered by <a href="https://x.com/okkichan3" className="text-white/40 hover:text-white/60 underline transition-colors">@okkichan3</a></p>
          </div>

          {/* Debug link */}
          <div className="mt-[2cqw] text-center">
            <a
              href="/debug/player"
              className="text-[2.5cqw] text-white/20 hover:text-white/40 underline transition-colors"
            >
              Debug: Player Component
            </a>
          </div>
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
