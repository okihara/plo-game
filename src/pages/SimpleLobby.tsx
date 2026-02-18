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
    <div className="h-full w-full light-bg relative overflow-y-auto">
      <div className="relative z-10 flex flex-col items-center px-[5cqw] py-[6cqw]">
        {/* Logo & Mascot */}
        <div className="text-center mb-[5cqw]">
          <div className="w-[28cqw] h-[28cqw] mx-auto mb-[2cqw] rounded-full overflow-hidden shadow-[0_4px_20px_rgba(139,126,106,0.25)] border-[0.5cqw] border-cream-300/60">
            <img
              src="/images/plo_baby.png"
              alt="Baby PLO"
              className="w-full h-full object-cover scale-125"
            />
          </div>
          <h1 className="text-[8cqw] font-bold text-cream-900 tracking-tight">Baby PLO</h1>
          <div className="mt-[2cqw] w-full px-[3cqw] py-[2cqw] bg-amber-50 border border-amber-300 rounded-[2cqw] text-[2.5cqw] text-amber-700 leading-relaxed">
            <p className="font-bold text-[3cqw] text-amber-800 mb-[1cqw] text-center">現在テスト中</p>
            <ul className="space-y-[0.3cqw]">
              <li>・データが予告なくリセットされる場合があります</li>
              <li>・チップに実際の価値はありません</li>
              <li>・不具合があればお気軽にお知らせください</li>
            </ul>
          </div>
        </div>

        {/* User Info or Login */}
        <div className="w-[90%]">
          {loading ? (
            <div className="text-center text-cream-500 text-[3.5cqw] mb-[5cqw]">読み込み中...</div>
          ) : user ? (
            <div className="bg-white border border-cream-300 rounded-[4cqw] p-[4cqw] mb-[4cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[2.5cqw]">
                  {user.avatarUrl && (
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="w-[12cqw] h-[12cqw] rounded-full border-[0.4cqw] border-cream-300 cursor-pointer hover:border-forest/50 transition-all"
                      onClick={() => setShowProfile(true)}
                    />
                  )}
                  <div>
                    <div className="text-[4cqw] text-cream-900 font-bold">{user.username}</div>
                    <div className="flex items-center gap-[1.5cqw] mt-[0.5cqw]">
                      <span className="text-[3.5cqw] font-bold text-forest">{user.balance}</span>
                      <button
                        onClick={handleClaimLoginBonus}
                        disabled={claimingBonus || !user.loginBonusAvailable}
                        className="px-[1.5cqw] py-[0.5cqw] text-[2.2cqw] bg-forest/10 text-forest font-bold rounded-[1cqw] hover:bg-forest/20 disabled:opacity-40 transition-all"
                      >
                        {claimingBonus ? '...' : user.loginBonusAvailable ? '600まで補填' : '受取済み'}
                      </button>
                      {import.meta.env.DEV && (
                        <button
                          onClick={handleDebugAddChips}
                          disabled={addingChips}
                          className="px-[1.5cqw] py-[0.5cqw] text-[2.2cqw] bg-cream-200 text-cream-600 font-bold rounded-[1cqw] hover:bg-cream-300 disabled:opacity-40 transition-all"
                        >
                          +10,000
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="text-[2.8cqw] text-cream-500 hover:text-cream-700 transition-colors"
                >
                  ログアウト
                </button>
              </div>
              <button
                onClick={() => {
                  window.history.pushState({}, '', '/history');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }}
                className="mt-[3cqw] pt-[3cqw] border-t border-cream-200 w-full flex items-center justify-between text-[3cqw] text-cream-600 hover:text-cream-900 transition-colors"
              >
                <span>ハンド履歴を見る</span>
                <span className="text-cream-400 text-[3.5cqw]">&rsaquo;</span>
              </button>
            </div>
          ) : (
            <div className="bg-white border border-cream-300 rounded-[4cqw] p-[5cqw] mb-[4cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
              <p className="text-[3.5cqw] text-cream-600 text-center mb-[3cqw]">ログインしてプレイ</p>
              <button
                onClick={handleLogin}
                className="w-full py-[2.5cqw] px-[4cqw] text-[3.5cqw] bg-forest text-white rounded-[2cqw] hover:bg-forest-light transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_4px_20px_rgba(45,90,61,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_28px_rgba(45,90,61,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_10px_rgba(45,90,61,0.3)]"
              >
                Twitterでログイン
              </button>
              <p className="text-[2.5cqw] text-cream-500 text-center mt-[3cqw]">
                またはゲストとしてプレイ
              </p>
            </div>
          )}

          {/* Chip refill notice */}
          <div className="mb-[4cqw] text-center text-[3.5cqw] text-cream-500">
            毎朝7:00にチップが補充されます
          </div>

          {/* Tables */}
          <div className="mb-[2.5cqw]">
            <h2 className="text-[4cqw] font-semibold text-cream-900 tracking-wide uppercase">レート</h2>
          </div>
          <div className="space-y-[2.5cqw]">
            {TABLE_OPTIONS.map((table) => {
              const count = playerCounts[table.blinds] ?? 0;
              return (
                <button
                  key={table.id}
                  onClick={() => table.enabled && onPlayOnline(table.blinds)}
                  disabled={!table.enabled}
                  className={`w-full py-[3.5cqw] px-[4cqw] rounded-[3cqw] transition-all duration-200 border ${
                    table.enabled
                      ? 'bg-white border-cream-300 shadow-[0_2px_8px_rgba(139,126,106,0.12)] hover:bg-cream-50 hover:border-cream-400 hover:shadow-[0_4px_16px_rgba(139,126,106,0.15)] active:scale-[0.98]'
                      : 'bg-cream-200/50 border-cream-300/50 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[3cqw]">
                      <span className={`px-[2cqw] py-[0.6cqw] text-[2.5cqw] font-bold rounded-[1cqw] ${
                        table.enabled
                          ? 'bg-forest/10 text-forest border border-forest/20'
                          : 'bg-cream-300/50 text-cream-500'
                      }`}>
                        {table.gameLabel}
                      </span>
                      <span className="text-[5cqw] font-bold text-cream-900">{table.blindsLabel}</span>
                    </div>
                    <div className="flex items-center gap-[2cqw] text-[2.8cqw]">
                      <span className="text-cream-600">buy-in: {table.buyIn}</span>
                      {table.enabled ? (
                        <>
                          <span className="px-[2cqw] py-[0.5cqw] text-[2.5cqw] font-bold text-white bg-forest rounded-[1.5cqw]">参加する</span>
                          <span className="text-forest">{count}人</span>
                        </>
                      ) : (
                        <span className="text-cream-500">準備中</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-[6cqw] text-center text-cream-500 text-[2.5cqw]">
            <p>Powered by <a href="https://x.com/okkichan3" className="text-cream-600 hover:text-cream-700 underline transition-colors">@okkichan3</a></p>
          </div>

          {/* Debug link */}
          <div className="mt-[2cqw] text-center">
            <a
              href="/debug/player"
              className="text-[2.5cqw] text-cream-400 hover:text-cream-600 underline transition-colors"
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
