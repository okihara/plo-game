import { useState, useEffect } from 'react';
import { Pencil, Trophy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ProfilePopup } from '../components/ProfilePopup';
import { ProfileEditDialog } from '../components/ProfileEditDialog';
import { RankingPopup } from '../components/RankingPopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';

import { LobbyLeaderboard } from '../components/LobbyLeaderboard';
import { WeeklyChampions } from '../components/WeeklyChampions';

interface SimpleLobbyProps {
  onPlayOnline: (blinds: string, isFastFold?: boolean, variant?: string) => void;
  onCreatePrivate: (blinds: string) => void;
  onJoinPrivate: (inviteCode: string) => void;
  onTournaments?: () => void;
}

interface TableOption {
  id: string;
  gameType: 'PLO' | 'NLH' | 'STUD' | 'HORSE';
  gameLabel: string;
  blinds: string;
  blindsLabel: string;
  buyIn: number;
  rake: string;
  enabled: boolean;
  isFastFold: boolean;
  variant?: string;
}

const TABLE_OPTIONS: TableOption[] = [
  { id: 'plo-1-3', gameType: 'PLO', gameLabel: 'PLO', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: false },
  { id: 'plo-1-3-ff', gameType: 'PLO', gameLabel: 'Fast Fold', blinds: '1/3', blindsLabel: '1/3', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: true },
  { id: 'stud-4-8', gameType: 'STUD', gameLabel: '7-Card Stud', blinds: '4/8', blindsLabel: '4/8', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: false, variant: 'stud' },
  { id: 'horse-4-8', gameType: 'HORSE', gameLabel: 'HORSE', blinds: '4/8', blindsLabel: '4/8', buyIn: 300, rake: '5% (3bb cap)', enabled: true, isFastFold: false, variant: 'horse' },
];

export function SimpleLobby({ onPlayOnline, onCreatePrivate, onJoinPrivate, onTournaments }: SimpleLobbyProps) {
  const { user, loading, logout, refreshUser } = useAuth();
  const [showProfile, setShowProfile] = useState(false);
  const [showProfileEdit, setShowProfileEdit] = useState(false);

  const [claimingBonus, setClaimingBonus] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [maintenance, setMaintenance] = useState<{ isActive: boolean; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState<{ isActive: boolean; message: string } | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [showRanking, setShowRanking] = useState(false);
  const [rankingRefreshKey, setRankingRefreshKey] = useState(0);
  const [showPrivateDialog, setShowPrivateDialog] = useState(false);


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
    const fetchAnnouncement = async () => {
      try {
        const res = await fetch(`${apiBase}/api/announcement/status`);
        if (res.ok) {
          setAnnouncement(await res.json());
        }
      } catch { /* ignore */ }
    };
    fetchCounts();
    fetchMaintenance();
    fetchAnnouncement();
    const interval = setInterval(() => { fetchCounts(); fetchMaintenance(); fetchAnnouncement(); }, 10000);
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


  const handleLogin = () => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    window.location.href = `${apiBase}/api/auth/twitter`;
  };

  return (
    <div className="h-full w-full light-bg relative overflow-hidden">
      <div className="relative z-10 flex flex-col items-center px-[3cqw] py-[2cqw] h-full min-h-0 overflow-y-auto">
        {/* Logo & Mascot */}
        <div className="mb-[1.5cqw] w-full">
          <div className="flex items-center justify-center gap-[2.5cqw]">
            <div className="w-[14cqw] h-[14cqw] rounded-full overflow-hidden shadow-[0_4px_20px_rgba(139,126,106,0.25)] border-[0.5cqw] border-cream-300/60 shrink-0">
              <img
                src="/images/plo_baby.png"
                alt="Baby PLO"
                className="w-full h-full object-cover scale-125"
              />
            </div>
            <div>
              <h1 className="text-[6cqw] font-bold text-cream-800 tracking-tight leading-none">BabyPLO <span className="text-[2.5cqw] font-normal text-cream-600">build {__COMMIT_HASH__}</span></h1>
              <p className="text-[3cqw] text-cream-700 mt-[0.5cqw]">いつでも入って、いつでも抜ける<br />気軽に遊べるPLOアプリ</p>
            </div>
          </div>
          {maintenance?.isActive && (
            <div className="mt-[1.5cqw] w-full px-[2cqw] py-[1.5cqw] bg-cream-50 border border-cream-400 rounded-[2cqw] text-[3cqw] text-cream-800 leading-relaxed">
              <p className="font-bold text-[3.5cqw] text-[#C0392B] text-center">メンテナンス中</p>
              {maintenance.message && (
                <p className="mt-[0.5cqw] text-center">{maintenance.message}</p>
              )}
            </div>
          )}
          {announcement?.isActive && !maintenance?.isActive && (
            <div className="mt-[1.5cqw] w-full px-[2cqw] py-[1.5cqw] bg-cream-50 border border-forest/20 rounded-[2cqw] text-[3cqw] text-cream-800 leading-relaxed">
              <p className="mt-[0.5cqw] text-center whitespace-pre-line">{announcement.message}</p>
            </div>
          )}
        </div>

        {/* User Info or Login */}
        <div className="w-[94%]">
          {loading ? (
            <div className="text-center text-cream-500 text-[4cqw] mb-[3cqw]">読み込み中...</div>
          ) : user ? (
            <div className="bg-white border border-cream-300 rounded-[3cqw] p-[3cqw] mb-[2.5cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-[2cqw]">
                  <div className="relative">
                    {user.avatarUrl && (
                      <img
                        src={user.avatarUrl}
                        alt={user.username}
                        className="w-[11cqw] h-[11cqw] rounded-full border-[0.4cqw] border-cream-300 cursor-pointer hover:border-forest/50 transition-all"
                        onClick={() => setShowProfile(true)}
                      />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-[1.5cqw]">
                      <span className="text-[4.5cqw] text-cream-900 font-bold">{user.displayName || user.username}</span>
                      <button
                        onClick={() => setShowProfileEdit(true)}
                        className="text-cream-700 hover:text-cream-900 transition-colors relative"
                      >
                        <Pencil className="w-[3.5cqw] h-[3.5cqw]" />
                        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[2cqw] px-[2cqw] py-[0.8cqw] bg-cream-900 text-white text-[2.5cqw] rounded-[1.5cqw] whitespace-nowrap animate-bounce-subtle">
                          名前・アイコンを変更
                          <span className="absolute top-full left-1/2 -translate-x-1/2 border-l-[1.2cqw] border-r-[1.2cqw] border-t-[1.2cqw] border-l-transparent border-r-transparent border-t-cream-900" />
                        </span>
                      </button>
                    </div>
                    <div className="flex items-center gap-[1.5cqw] mt-[0.5cqw]">
                      <span className="text-[4cqw] font-bold text-forest">{user.balance}</span>
                      <button
                        onClick={handleClaimLoginBonus}
                        disabled={claimingBonus || !user.loginBonusAvailable}
                        className="px-[1.5cqw] py-[0.5cqw] text-[2.5cqw] bg-forest/10 text-forest font-bold rounded-[1cqw] hover:bg-forest/20 disabled:opacity-40 transition-all"
                      >
                        {claimingBonus ? '...' : user.loginBonusAvailable ? '1000まで補填' : '受取済み'}
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  onClick={logout}
                  className="text-[3cqw] text-cream-500 hover:text-cream-700 transition-colors"
                >
                  ログアウト
                </button>
              </div>
              <div className="mt-[2cqw] pt-[2cqw] border-t border-cream-200 w-full flex items-center gap-[1.5cqw] text-[3cqw]">
                <button
                  onClick={() => setShowHandHistory(true)}
                  className="flex-1 py-[1.5cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
                  ハンド履歴
                </button>
                <button
                  onClick={() => setShowProfile(true)}
                  className="flex-1 py-[1.5cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  Stats
                </button>
                <button
                  onClick={() => setShowRanking(true)}
                  className="flex-1 py-[1.5cqw] bg-cream-100 border border-cream-300 rounded-[2cqw] text-cream-700 font-bold hover:bg-cream-200 active:scale-[0.97] transition-all flex items-center justify-center gap-[1cqw]"
                >
                  <svg className="w-[3.5cqw] h-[3.5cqw]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                  ランキング
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-cream-300 rounded-[3cqw] p-[3cqw] mb-[2.5cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
              <p className="text-[4cqw] text-cream-600 text-center mb-[2cqw]">ログインしてプレイ</p>
              <button
                onClick={handleLogin}
                className="w-full py-[2.5cqw] px-[3cqw] text-[4cqw] bg-forest text-white rounded-[2cqw] hover:bg-forest-light transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_4px_20px_rgba(45,90,61,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_28px_rgba(45,90,61,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_10px_rgba(45,90,61,0.3)]"
              >
                Twitterでログイン
              </button>
            </div>
          )}

          {/* Tournament Button */}
          {onTournaments && (
            <button
              onClick={onTournaments}
              className="w-full py-[3cqw] px-[3cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] bg-gradient-to-b from-amber-500 to-amber-600 border-amber-700/40 shadow-[0_4px_12px_rgba(180,120,30,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_6px_20px_rgba(180,120,30,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(180,120,30,0.3),inset_0_1px_4px_rgba(0,0,0,0.1)] text-white font-bold text-[4cqw] flex items-center justify-center gap-[2cqw]"
            >
              <Trophy className="w-[4.5cqw] h-[4.5cqw]" />
              トーナメント
              <svg className="w-[3.5cqw] h-[3.5cqw] text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}

          {/* Tables - Fast Fold */}
          <div className="mt-[2cqw] space-y-[2cqw]">
            {TABLE_OPTIONS.filter(t => t.isFastFold).map((table) => {
              const count = playerCounts[`${table.blinds}-ff`] ?? 0;
              return (
                <button
                  key={table.id}
                  onClick={() => table.enabled && !maintenance?.isActive && user && onPlayOnline(table.blinds, true)}
                  disabled={!table.enabled || !!maintenance?.isActive || !user}
                  className={`w-full py-[3cqw] px-[3cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] ${
                    table.enabled && !maintenance?.isActive && user
                      ? 'bg-gradient-to-b from-forest to-forest-dark border-forest-dark/30 shadow-[0_4px_12px_rgba(45,90,61,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_20px_rgba(45,90,61,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(45,90,61,0.3),inset_0_1px_4px_rgba(0,0,0,0.1)]'
                      : 'bg-gradient-to-b from-forest to-forest-dark border-forest-dark/30 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-[2cqw]">
                      <span className="text-[4.5cqw] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)] whitespace-nowrap">PLO Fast Fold</span>
                      <div className="flex flex-col items-start">
                        <span className="text-[3cqw] font-bold text-white/90">{table.blindsLabel} <span className="font-normal text-white/70">rake: {table.rake}</span></span>
                        <span className="text-[3cqw] text-white/70">buy-in: {table.buyIn}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-[2cqw]">
                      {table.enabled ? (
                        <>
                          <span className="text-[3cqw] text-white/80">{count}人</span>
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

          {/* Tables - Private (一時的に非表示) */}
          {/* <div className="mt-[2.5cqw] flex gap-[2cqw]">
            <button
              onClick={() => user && !maintenance?.isActive && setShowPrivateDialog(true)}
              disabled={!user || !!maintenance?.isActive}
              className={`flex-1 py-[2.5cqw] px-[3cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] ${
                user && !maintenance?.isActive
                  ? 'bg-gradient-to-b from-cream-700 to-cream-800 border-cream-900/40 shadow-[0_4px_12px_rgba(139,126,106,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_20px_rgba(139,126,106,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(139,126,106,0.25),inset_0_1px_4px_rgba(0,0,0,0.1)]'
                  : 'bg-gradient-to-b from-cream-700 to-cream-800 border-cream-900/40 opacity-50 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center justify-center gap-[2cqw]">
                <svg className="w-[5cqw] h-[5cqw] text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.15)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <div className="flex flex-col items-start">
                  <span className="text-[2.8cqw] font-bold text-white/90">プライベート</span>
                  <span className="text-[2cqw] text-white/70">1/3</span>
                </div>
              </div>
            </button>
          </div> */}

          {/* Weekly Champions */}
          <WeeklyChampions />

          {/* Mini Leaderboard */}
          <LobbyLeaderboard userId={user?.id} onShowFull={() => setShowRanking(true)} refreshKey={rankingRefreshKey} />

          {/* Footer */}
          <div className="mt-[4cqw] text-center text-cream-500 text-[2.8cqw]">
            <p>Powered by <a href="https://x.com/okkichan3" className="text-cream-600 hover:text-cream-700 underline transition-colors">@okkichan3</a></p>
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
          name={user.displayName || user.username}
          avatarUrl={user.avatarUrl}
          userId={user.id}
          isSelf
          onClose={() => setShowProfile(false)}
          onProfileUpdated={refreshUser}
          twitterAvatarUrl={user.twitterAvatarUrl}
          useTwitterAvatar={user.useTwitterAvatar}
        />
      )}

      {/* Profile Edit Dialog */}
      {showProfileEdit && user && (
        <ProfileEditDialog
          currentName={user.displayName || user.username}
          currentAvatarUrl={user.avatarUrl ?? null}
          twitterAvatarUrl={user.twitterAvatarUrl ?? null}
          useTwitterAvatar={user.useTwitterAvatar ?? false}
          onClose={() => setShowProfileEdit(false)}
          onSaved={() => { setShowProfileEdit(false); refreshUser(); }}
        />
      )}

      {/* Private Table Dialog */}
      {showPrivateDialog && (
        <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={() => setShowPrivateDialog(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="relative w-[85cqw] bg-white rounded-[4cqw] shadow-2xl overflow-hidden p-[5cqw]"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="text-[4cqw] font-bold text-cream-900 text-center mb-[4cqw]">プライベートテーブル</h2>

            {/* 招待コードで参加 */}
            <div className="mb-[4cqw]">
              <p className="text-[2.8cqw] text-cream-600 mb-[2cqw]">招待コードで参加</p>
              <div className="flex gap-[2cqw]">
                <input
                  type="text"
                  placeholder="コード入力"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''))}
                  maxLength={5}
                  className="w-[52cqw] px-[3cqw] py-[2.5cqw] text-[3.5cqw] border border-cream-300 rounded-[2cqw] text-cream-900 placeholder-cream-400 text-center tracking-[0.3em] font-mono uppercase bg-cream-50"
                />
                <button
                  onClick={() => { if (inviteCodeInput.length >= 4) { onJoinPrivate(inviteCodeInput); setInviteCodeInput(''); setShowPrivateDialog(false); } }}
                  disabled={inviteCodeInput.length < 4 || !!maintenance?.isActive}
                  className="w-[21cqw] py-[2.5cqw] text-[3cqw] bg-forest text-white rounded-[2cqw] font-bold disabled:opacity-40 transition-all active:scale-[0.97]"
                >
                  参加
                </button>
              </div>
            </div>

            {/* テーブル作成 */}
            <div className="border-t border-cream-200 pt-[4cqw]">
              <p className="text-[2.8cqw] text-cream-600 mb-[2cqw]">新しいテーブルを作成</p>
              <button
                onClick={() => { onCreatePrivate('1/3'); setShowPrivateDialog(false); }}
                disabled={!!maintenance?.isActive}
                className="w-full py-[3cqw] text-[3.5cqw] bg-cream-800 text-white rounded-[2cqw] font-bold disabled:opacity-40 transition-all active:scale-[0.97] shadow-[0_4px_12px_rgba(139,126,106,0.3)]"
              >
                PLO 1/3 テーブルを作成
              </button>
            </div>

            {/* 閉じるボタン */}
            <button
              onClick={() => setShowPrivateDialog(false)}
              className="mt-[4cqw] w-full py-[2.5cqw] text-[3cqw] text-cream-500 hover:text-cream-700 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Ranking Popup */}
      {showRanking && user && (
        <RankingPopup
          userId={user.id}
          onClose={() => { setShowRanking(false); setRankingRefreshKey(k => k + 1); }}
        />
      )}


    </div>
  );
}
