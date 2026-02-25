import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ProfilePopup } from '../components/ProfilePopup';
import { RankingPopup } from '../components/RankingPopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { SettingConfig } from '../components/SettingConfig';
import { LobbyLeaderboard } from '../components/LobbyLeaderboard';

interface SimpleLobbyProps {
  onPlayOnline: (blinds: string, isFastFold?: boolean) => void;
}

interface TableOption {
  id: string;
  gameType: 'PLO' | 'NLH';
  gameLabel: string;
  blinds: string;
  blindsLabel: string;
  buyIn: number;
  rake: string;
  enabled: boolean;
  isFastFold: boolean;
}

const TABLE_OPTIONS: TableOption[] = [
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: false },
  { id: 'plo-1-3-ff', gameType: 'PLO', gameLabel: 'Fast Fold', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: true },
];

export function SimpleLobby({ onPlayOnline }: SimpleLobbyProps) {
  const { user, loading, logout, refreshUser } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [addingChips, setAddingChips] = useState(false);
  const [claimingBonus, setClaimingBonus] = useState(false);
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [maintenance, setMaintenance] = useState<{ isActive: boolean; message: string } | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    const fetchCounts = async () => {
      try {
        const res = await fetch(`${apiBase}/api/lobby/tables`);
        if (res.ok) {
          const data: { blinds: string; playerCount: number; isFastFold: boolean }[] = await res.json();
          const counts: Record<string, number> = {};
          for (const d of data) {
            const key = d.isFastFold ? `${d.blinds}-ff` : d.blinds;
            counts[key] = d.playerCount;
          }
          setPlayerCounts(counts);
        }
      } catch { /* ignore */ }
    };
    const fetchMaintenance = async () => {
      try {
        const res = await fetch(`${apiBase}/api/maintenance/status`);
        if (res.ok) {
          setMaintenance(await res.json());
        }
      } catch { /* ignore */ }
    };
    fetchCounts();
    fetchMaintenance();
    const interval = setInterval(() => { fetchCounts(); fetchMaintenance(); }, 10000);
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
    <div className="h-full w-full light-bg relative overflow-hidden">
      <div className="relative z-10 flex flex-col items-center px-[5cqw] py-[4cqw] h-full min-h-0 overflow-y-auto">
        {/* Logo & Mascot */}
        <div className="text-center mb-[3cqw]">
          <div className="w-[20cqw] h-[20cqw] mx-auto mb-[1.5cqw] rounded-full overflow-hidden shadow-[0_4px_20px_rgba(139,126,106,0.25)] border-[0.5cqw] border-cream-300/60">
            <img
              src="/images/plo_baby.png"
              alt="Baby PLO"
              className="w-full h-full object-cover scale-125"
            />
          </div>
          <h1 className="text-[6cqw] font-bold text-cream-900 tracking-tight">Baby PLO</h1>
          {maintenance?.isActive && (
            <div className="mt-[2cqw] w-full px-[3cqw] py-[2cqw] bg-red-50 border border-red-300 rounded-[2cqw] text-[2.5cqw] text-red-700 leading-relaxed">
              <p className="font-bold text-[3cqw] text-red-800 text-center">メンテナンス中</p>
              {maintenance.message && (
                <p className="mt-[1cqw] text-center">{maintenance.message}</p>
              )}
            </div>
          )}
        </div>

        {/* User Info or Login */}
        <div className="w-[90%]">
          {loading ? (
            <div className="text-center text-cream-500 text-[3.5cqw] mb-[5cqw]">読み込み中...</div>
          ) : user ? (
            <div className="bg-white border border-cream-300 rounded-[4cqw] p-[4cqw] mb-[4cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[2.5cqw]">
                  <div className="relative">
                    {user.avatarUrl && (
                      <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="w-[12cqw] h-[12cqw] rounded-full border-[0.4cqw] border-cream-300 cursor-pointer hover:border-forest/50 transition-all"
                        onClick={() => setShowProfile(true)}
                      />
                    )}
                    <button
                      onClick={() => setShowSettings(true)}
                      className="absolute -bottom-[0.5cqw] -right-[0.5cqw] w-[5cqw] h-[5cqw] bg-white border border-cream-300 rounded-full flex items-center justify-center shadow-sm hover:bg-cream-100 active:scale-90 transition-all"
                    >
                      <svg className="w-[3cqw] h-[3cqw] text-cream-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                    </button>
                  </div>
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
              <div className="mt-[3cqw] pt-[3cqw] border-t border-cream-200 w-full flex items-center gap-[2cqw] text-[2.8cqw]">
                <button
                  onClick={() => setShowHandHistory(true)}
                  className="flex-1 py-[2cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                  ハンド履歴
                </button>
                <button
                  onClick={() => setShowProfile(true)}
                  className="flex-1 py-[2cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  Stats
                </button>
                <button
                  onClick={() => setShowRanking(true)}
                  className="flex-1 py-[2cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                  ランキング
                </button>
              </div>
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
            </div>
          )}

          {/* Tables - Fast Fold */}
          <div className="space-y-[2.5cqw]">
            {TABLE_OPTIONS.filter(t => t.isFastFold).map((table) => {
              const count = playerCounts[`${table.blinds}-ff`] ?? 0;
              return (
                <button
                  key={table.id}
                  onClick={() => table.enabled && !maintenance?.isActive && user && onPlayOnline(table.blinds, true)}
                  disabled={!table.enabled || !!maintenance?.isActive || !user}
                  className={`w-full py-[4cqw] px-[4cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] ${
                    table.enabled && !maintenance?.isActive
                      ? 'bg-gradient-to-b from-amber-400 to-amber-500 border-amber-600/30 shadow-[0_4px_12px_rgba(245,158,11,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.45),inset_0_1px_0_rgba(255,255,255,0.3)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(245,158,11,0.3),inset_0_1px_4px_rgba(0,0,0,0.1)]'
                      : 'bg-cream-200/50 border-cream-300/50 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[2.5cqw]">
                      <span className="text-[5cqw] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">{table.blindsLabel}</span>
                      <div className="flex flex-col items-start">
                        <span className="text-[2.8cqw] font-bold text-white/90">PLO Fast Fold</span>
                        <span className="text-[2.3cqw] text-white/70">buy-in: {table.buyIn} / rake: {table.rake}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-[2cqw]">
                      {table.enabled ? (
                        <>
                          <span className="text-[2.8cqw] text-white/80">{count}人</span>
                          <svg className="w-[4cqw] h-[4cqw] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
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

          {/* Tables - Normal */}
          <div className="mt-[2.5cqw] space-y-[2.5cqw]">
            {TABLE_OPTIONS.filter(t => !t.isFastFold).map((table) => {
              const count = playerCounts[table.blinds] ?? 0;
              return (
                <button
                  key={table.id}
                  onClick={() => table.enabled && !maintenance?.isActive && user && onPlayOnline(table.blinds, false)}
                  disabled={!table.enabled || !!maintenance?.isActive || !user}
                  className={`w-full py-[4cqw] px-[4cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] ${
                    table.enabled && !maintenance?.isActive
                      ? 'bg-gradient-to-b from-forest-light to-forest border-forest/40 shadow-[0_4px_12px_rgba(45,90,61,0.3),inset_0_1px_0_rgba(255,255,255,0.25)] hover:shadow-[0_6px_20px_rgba(45,90,61,0.4),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(45,90,61,0.25),inset_0_1px_4px_rgba(0,0,0,0.1)]'
                      : 'bg-cream-200/50 border-cream-300/50 opacity-40 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[2.5cqw]">
                      <span className="text-[5cqw] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]">{table.blindsLabel}</span>
                      <div className="flex flex-col items-start">
                        <span className="text-[2.8cqw] font-bold text-white/90">PLO</span>
                        <span className="text-[2.3cqw] text-white/70">buy-in: {table.buyIn} / rake: {table.rake}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-[2cqw]">
                      {table.enabled ? (
                        <>
                          <span className="text-[2.8cqw] text-white/80">{count}人</span>
                          <svg className="w-[4cqw] h-[4cqw] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
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

          {/* Mini Leaderboard */}
          <LobbyLeaderboard userId={user?.id} onShowFull={() => setShowRanking(true)} />

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

      {/* Hand History Popup */}
      {showHandHistory && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={() => setShowHandHistory(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-[92%] h-[90%] bg-white rounded-2xl shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <HandHistoryPanel onClose={() => setShowHandHistory(false)} />
          </div>
        </div>
      )}

      {/* Profile Popup */}
      {showProfile && user && (
        <ProfilePopup
          name={user.username}
          avatarUrl={user.avatarUrl}
          userId={user.id}
          isSelf
          onClose={() => setShowProfile(false)}
        />
      )}

      {/* Ranking Popup */}
      {showRanking && user && (
        <RankingPopup
          userId={user.id}
          onClose={() => setShowRanking(false)}
        />
      )}

      {/* Settings Popup */}
      {showSettings && user && (
        <SettingConfig onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
