import { useState, useEffect } from 'react';
import { Pencil, Trophy, Settings, Zap, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ProfilePopup } from '../components/ProfilePopup';
import { ProfileEditDialog } from '../components/ProfileEditDialog';
import { RankingPopup } from '../components/RankingPopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { BottomNavigation, type LobbyTab } from '../components/BottomNavigation';
import { TournamentList } from '../components/TournamentList';
import { SettingsPopup } from '../components/SettingsPopup';

import { LobbyLeaderboard } from '../components/LobbyLeaderboard';
import { WeeklyChampions } from '../components/WeeklyChampions';

const DISCORD_INVITE_URL = 'https://discord.com/invite/p34UPVDTW';

interface SimpleLobbyProps {
  onPlayOnline: (blinds: string, isFastFold?: boolean, variant?: string) => void;
  onCreatePrivate: (blinds: string, maxPlayers: 6 | 9) => void;
  onJoinPrivate: (inviteCode: string) => void;
  onJoinTournament: (tournamentId: string) => void;
  onViewMyResult: (tournamentId: string) => void;
  onViewResults: (tournamentId: string) => void;
  onWatchFinalTable: (tournamentId: string, tableId: string) => void;
  initialTab?: LobbyTab;
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

export function SimpleLobby({ onPlayOnline, onCreatePrivate, onJoinPrivate, onJoinTournament, onViewMyResult, onViewResults, onWatchFinalTable, initialTab = 'home' }: SimpleLobbyProps) {
  const { user, loading, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<LobbyTab>(initialTab);
  const [showProfileEdit, setShowProfileEdit] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [claimingBonus, setClaimingBonus] = useState(false);
  const [inviteCodeInput, setInviteCodeInput] = useState('');
  const [playerCounts, setPlayerCounts] = useState<Record<string, number>>({});
  const [maintenance, setMaintenance] = useState<{ isActive: boolean; message: string } | null>(null);
  const [announcement, setAnnouncement] = useState<{ isActive: boolean; message: string } | null>(null);
  const [showPrivateDialog, setShowPrivateDialog] = useState(false);
  const [privateSeatCount, setPrivateSeatCount] = useState<6 | 9>(6);
  const [tournamentSummary, setTournamentSummary] = useState<{ status: 'scheduled' | 'running' | 'none'; time?: string; isRegistrationOpen?: boolean; deadlineTime?: string }>({ status: 'none' });
  // 結果発表バナー用。シーズン名をハードコードせずサーバーの公開済みシーズンに追従する
  const [latestSeason, setLatestSeason] = useState<{ id: number; name: string } | null>(null);


  useEffect(() => {
    const apiBase = import.meta.env.VITE_SERVER_URL || '';
    const fetchTournaments = async () => {
      try {
        const res = await fetch(`${apiBase}/api/tournaments`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json() as { tournaments?: { status: string; scheduledStartTime?: string; isRegistrationOpen: boolean; registrationDeadlineAt?: string }[] };
        const list = data.tournaments ?? [];
        const running = list.find(t => ['running', 'starting', 'final_table', 'heads_up'].includes(t.status));
        const waiting = list.find(t => t.status === 'waiting' && t.scheduledStartTime);
        if (running) {
          let deadlineTime: string | undefined;
          if (running.registrationDeadlineAt) {
            const d = new Date(running.registrationDeadlineAt);
            deadlineTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
          setTournamentSummary({ status: 'running', isRegistrationOpen: running.isRegistrationOpen, deadlineTime });
        } else if (waiting?.scheduledStartTime) {
          const d = new Date(waiting.scheduledStartTime);
          const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          setTournamentSummary({ status: 'scheduled', time });
        } else {
          setTournamentSummary({ status: 'none' });
        }
      } catch { /* ignore */ }
    };
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
    const fetchLatestSeason = async () => {
      try {
        const res = await fetch(`${apiBase}/api/season/list`);
        if (!res.ok) return;
        const data = await res.json() as { seasons?: { id: number; name: string }[] };
        // 一覧は古い順。結果発表バナーは最新の確定シーズンを指す
        const seasons = data.seasons ?? [];
        const latest = seasons[seasons.length - 1];
        if (latest) setLatestSeason(latest);
      } catch { /* ignore */ }
    };
    fetchTournaments();
    fetchCounts();
    fetchMaintenance();
    fetchAnnouncement();
    fetchLatestSeason();
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

  const handleTabChange = (tab: LobbyTab) => {
    setActiveTab(tab);
  };

  const renderHomeTab = () => (
    <div className="flex flex-col items-center h-full min-h-0 overflow-y-auto px-[1cqw]">
      {/* Logo & Title */}
      <div className="mb-[1cqw] w-full bg-forest px-[3cqw] py-[2cqw] rounded-b-[2cqw] shadow-[0_8px_30px_rgba(29,58,39,0.5),0_4px_12px_rgba(0,0,0,0.3)]">
        <div className="flex items-center gap-[1cqw]">
          <div className="w-[6cqw] h-[6cqw] rounded-full overflow-hidden border-[0.3cqw] border-white/30 shrink-0">
            <img
              src="/images/plo_baby.png"
              alt="Baby PLO"
              className="w-full h-full object-cover scale-125"
            />
          </div>
          <h1 className="text-[5cqw] font-bold text-white tracking-tight leading-none">BabyPLO <span className="text-[3.0cqw] font-normal text-white/60">ver.{__COMMIT_HASH__}</span></h1>
          <button onClick={() => setShowSettings(true)} className="ml-auto text-white/80 hover:text-white transition-colors shrink-0">
            <Settings className="w-[5cqw] h-[5cqw]" />
          </button>
        </div>
        {maintenance?.isActive && (
          <div className="mt-[1.5cqw] w-full px-[2cqw] py-[1.5cqw] bg-white/10 border border-white/20 rounded-[2cqw] text-[3cqw] text-white/90 leading-relaxed">
            <p className="font-bold text-[3.5cqw] text-[#FF6B6B] text-center">メンテナンス中</p>
            {maintenance.message && (
              <p className="mt-[0.5cqw] text-center">{maintenance.message}</p>
            )}
          </div>
        )}
        {announcement?.isActive && !maintenance?.isActive && (
          <div className="mt-[1.5cqw] w-full px-[2cqw] py-[1.5cqw] bg-white/10 border border-white/20 rounded-[2cqw] text-[3cqw] text-white/90 leading-relaxed">
            <p className="mt-[0.5cqw] text-center whitespace-pre-line">{announcement.message}</p>
          </div>
        )}
      </div>
      {/* User Info or Login */}
      <div className="mb-[1cqw] w-full px-[2cqw]">
        {loading ? (
          <div className="text-center text-cream-700 text-[4cqw] mb-[3cqw]">読み込み中...</div>
        ) : user ? (
          <div className="flex items-center gap-[1cqw] mt-[1cqw]">
            {user.avatarUrl && (
              <img
                src={user.avatarUrl}
                alt={user.username}
                className="w-[9cqw] h-[9cqw] rounded-full border-[0.3cqw] border-cream-300 cursor-pointer hover:border-forest/50 transition-all shrink-0"
                onClick={() => setActiveTab('profile')}
              />
            )}
            <span className="text-[3.5cqw] text-cream-900 font-bold truncate">{user.displayName || user.username}</span>
            <button
              onClick={() => setShowProfileEdit(true)}
              className="text-cream-800 hover:text-cream-900 transition-colors shrink-0 relative"
            >
              <Pencil className="w-[3cqw] h-[3cqw]" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-[1.5cqw] px-[2cqw] py-[0.6cqw] bg-cream-900 text-white text-[2.2cqw] rounded-[1.5cqw] whitespace-nowrap animate-bounce-subtle">
                名前・アイコンを変更
                <span className="absolute top-full left-1/2 -translate-x-1/2 border-l-[1cqw] border-r-[1cqw] border-t-[1cqw] border-l-transparent border-r-transparent border-t-cream-900" />
              </span>
            </button>
            <span className="text-[3.5cqw] font-bold text-forest ml-auto shrink-0">{user.balance}</span>
            <button
              onClick={handleClaimLoginBonus}
              disabled={claimingBonus || !user.loginBonusAvailable}
              className="px-[1.5cqw] py-[0.3cqw] text-[2.8cqw] bg-forest/10 text-forest font-bold rounded-[1cqw] hover:bg-forest/20 disabled:opacity-40 transition-all shrink-0"
            >
              {claimingBonus ? '...' : user.loginBonusAvailable ? 'ログインボーナス' : '受取済み'}
            </button>
          </div>
        ) : (
          <div className="mt-[1.5cqw] bg-white border border-cream-300 rounded-[3cqw] p-[3cqw] shadow-[0_4px_16px_rgba(139,126,106,0.1)]">
            <p className="text-[4cqw] text-cream-700 text-center mb-[2cqw]">ログインしてプレイ</p>
            <button
              onClick={handleLogin}
              className="w-full py-[2.5cqw] px-[3cqw] text-[4cqw] bg-forest text-white rounded-[2cqw] hover:bg-forest-light transition-all font-bold flex items-center justify-center gap-[2cqw] shadow-[0_4px_20px_rgba(45,90,61,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_28px_rgba(45,90,61,0.5),inset_0_1px_0_rgba(255,255,255,0.25)] active:scale-[0.97] active:shadow-[0_2px_10px_rgba(45,90,61,0.3)]"
            >
              Twitterでログイン
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="w-[88%]">
        {/* シーズン結果発表バナー（公開済みシーズンがあるときだけ） */}
        {latestSeason && (
        <button
          onClick={() => {
            window.history.pushState({}, '', '/season');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="mb-[1cqw] w-full flex items-center gap-[3cqw] px-[3.5cqw] py-[3cqw] rounded-[3cqw] bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 border-[0.4cqw] border-amber-300 text-white shadow-[0_4px_16px_rgba(180,120,30,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] active:scale-[0.98] transition-all"
        >
          <Trophy className="w-[7cqw] h-[7cqw] shrink-0 drop-shadow" />
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[3.8cqw] font-extrabold leading-tight">{latestSeason.name} 結果発表</p>
            <p className="text-[2.7cqw] text-white/85 leading-tight">TOP10表彰＆特別アワードを公開中！</p>
          </div>
          <svg className="w-[3.5cqw] h-[3.5cqw] text-white/80 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
        )}

        {/* Weekly Champions */}
        <WeeklyChampions />

        {/* Mini Leaderboard */}
        <LobbyLeaderboard userId={user?.id} onShowFull={() => setActiveTab('ranking')} />

        {/* X Follow Banner */}
        <a
          href="https://x.com/babyplo4"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[1cqw] w-full flex items-center gap-[2cqw] px-[3cqw] py-[2.5cqw] bg-cream-900 rounded-[2.5cqw] text-white hover:bg-cream-800 active:scale-[0.98] transition-all"
        >
          <svg className="w-[5cqw] h-[5cqw] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          <div className="flex-1 min-w-0">
            <p className="text-[3cqw] font-bold leading-tight">公式Xアカウントをフォロー</p>
            <p className="text-[2.5cqw] text-white/70">最新情報やイベント告知をお届けします</p>
          </div>
          <svg className="w-[3.5cqw] h-[3.5cqw] text-white/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </a>

        {/* Discord Banner */}
        <a
          href={DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-[1cqw] w-full flex items-center gap-[2cqw] px-[3cqw] py-[2.5cqw] bg-[#5865F2] rounded-[2.5cqw] text-white hover:bg-[#4752C4] active:scale-[0.98] transition-all"
        >
          <svg className="w-[5cqw] h-[5cqw] shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>
          <div className="flex-1 min-w-0">
            <p className="text-[3cqw] font-bold leading-tight">Discordサーバーに参加</p>
            <p className="text-[2.5cqw] text-white/70">ハンド相談や雑談はこちらで</p>
          </div>
          <svg className="w-[3.5cqw] h-[3.5cqw] text-white/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </a>

        {/* Tournament & Fast Fold - Side by Side */}
        {(() => {
        const tournamentOpen = tournamentSummary.status === 'running' && tournamentSummary.isRegistrationOpen;
        return (
        <div className="mt-[1cqw] flex gap-[2cqw]">
          {/* Tournament Button — 受付中はボタン自体を派手にして目立たせる */}
          <button
            onClick={() => setActiveTab('tournament')}
            className={`relative flex-1 h-[29cqw] px-[3cqw] pt-[4cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] text-white font-bold text-[4cqw] flex flex-col items-center gap-[1cqw] ${
              tournamentOpen
                ? 'bg-gradient-to-b from-amber-400 via-amber-500 to-orange-600 border-amber-300 ring-[0.5cqw] ring-amber-300/80 animate-tournament-glow active:scale-[0.97]'
                : 'bg-gradient-to-b from-amber-500 to-amber-600 border-amber-700/40 shadow-[0_4px_12px_rgba(180,120,30,0.35),inset_0_1px_0_rgba(255,255,255,0.3)] hover:shadow-[0_6px_20px_rgba(180,120,30,0.5),inset_0_1px_0_rgba(255,255,255,0.3)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(180,120,30,0.3),inset_0_1px_4px_rgba(0,0,0,0.1)]'
            }`}
          >
            {tournamentOpen && (
              <span className="absolute -top-[1.5cqw] left-1/2 -translate-x-1/2 px-[2.5cqw] py-[0.4cqw] rounded-full bg-[#C0392B] text-white text-[2.6cqw] font-bold whitespace-nowrap shadow-[0_2px_6px_rgba(0,0,0,0.3)] flex items-center gap-[1cqw] animate-bounce-subtle">
                <span className="w-[1.6cqw] h-[1.6cqw] rounded-full bg-white animate-pulse" />
                受付中
              </span>
            )}
            <Trophy className="w-[6cqw] h-[6cqw]" />
            <span>トーナメント</span>
            {tournamentSummary.status === 'running' ? (
              tournamentSummary.isRegistrationOpen ? (
                <span className="text-[4cqw] font-bold text-white leading-tight">
                  {tournamentSummary.deadlineTime ? `${tournamentSummary.deadlineTime} まで受付` : 'エントリー受付中'}
                </span>
              ) : (
                <span className="text-[2.8cqw] font-normal text-white/80">エントリー締切</span>
              )
            ) : tournamentSummary.status === 'scheduled' ? (
              <span className="text-[3cqw] font-normal text-white/80 leading-tight">
                開催予定 <span className="text-[4cqw] font-bold text-white">{tournamentSummary.time}</span> から
              </span>
            ) : null}
          </button>

          {/* Fast Fold Button */}
          {TABLE_OPTIONS.filter(t => t.isFastFold).map((table) => {
            const count = playerCounts[`${table.blinds}-ff`] ?? 0;
            return (
              <button
                key={table.id}
                onClick={() => table.enabled && !maintenance?.isActive && user && onPlayOnline(table.blinds, true)}
                disabled={!table.enabled || !!maintenance?.isActive || !user}
                className={`flex-1 h-[29cqw] px-[3cqw] pt-[4cqw] rounded-[3cqw] transition-all duration-150 border-[0.4cqw] flex flex-col items-center gap-[1cqw] ${
                  table.enabled && !maintenance?.isActive && user
                    ? 'bg-gradient-to-b from-forest to-forest-dark border-forest-dark/30 shadow-[0_4px_12px_rgba(45,90,61,0.35),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_20px_rgba(45,90,61,0.45),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.97] active:shadow-[0_2px_6px_rgba(45,90,61,0.3),inset_0_1px_4px_rgba(0,0,0,0.1)]'
                    : 'bg-gradient-to-b from-forest to-forest-dark border-forest-dark/30 opacity-50 cursor-not-allowed'
                }`}
              >
                <Zap className="w-[6cqw] h-[6cqw]" />
                <span className="text-[4cqw] font-bold text-white">リングをプレイ</span>
                <span className="text-[3cqw] text-white/80">Fast Fold - {table.blindsLabel} - buy-in:{table.buyIn}</span>
                <span className="text-[2.8cqw] text-white/60">{count}人プレイ中</span>
              </button>
            );
          })}
        </div>
        );
        })()}

        {/* Private Table Button */}
        <button
          onClick={() => user && !maintenance?.isActive && setShowPrivateDialog(true)}
          disabled={!user || !!maintenance?.isActive}
          className={`mt-[1cqw] w-full flex items-center gap-[2cqw] px-[3cqw] py-[2.5cqw] rounded-[2.5cqw] text-white transition-all border-[0.4cqw] ${
            user && !maintenance?.isActive
              ? 'bg-gradient-to-b from-cream-700 to-cream-800 border-cream-900/40 shadow-[0_4px_12px_rgba(139,126,106,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:shadow-[0_6px_20px_rgba(139,126,106,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] active:scale-[0.98]'
              : 'bg-gradient-to-b from-cream-700 to-cream-800 border-cream-900/40 opacity-50 cursor-not-allowed'
          }`}
        >
          <Users className="w-[4.5cqw] h-[4.5cqw] shrink-0" />
          <span className="text-[3cqw] font-bold">プライベートテーブル</span>
          <span className="flex-1 min-w-0 text-left text-[2.5cqw] text-white/70 truncate">招待コードで友達と対戦</span>
          <svg className="w-[3.5cqw] h-[3.5cqw] text-white/60 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>

        {/* Spacer for bottom nav */}
        <div className="h-[16cqw]" />
      </div>
    </div>
  );

  const renderProfileTab = () => {
    if (!user) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-cream-700 mb-[4cqw] text-[3.5cqw]">ログインするとプロフィールを確認できます</p>
            <button
              onClick={handleLogin}
              className="px-[6cqw] py-[2.5cqw] text-[3.5cqw] bg-forest text-white rounded-[2cqw] font-bold"
            >
              Twitterでログイン
            </button>
          </div>
        </div>
      );
    }
    return (
      <ProfilePopup
        name={user.displayName || user.username}
        avatarUrl={user.avatarUrl}
        userId={user.id}
        isSelf
        onProfileUpdated={refreshUser}
        twitterAvatarUrl={user.twitterAvatarUrl}
        useTwitterAvatar={user.useTwitterAvatar}
      />
    );
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'home':
        return renderHomeTab();
      case 'tournament':
        return (
          <TournamentList
            onJoinTournament={onJoinTournament}
            onViewMyResult={onViewMyResult}
            onViewResults={onViewResults}
            onWatchFinalTable={onWatchFinalTable}
          />
        );
      case 'history':
        return <HandHistoryPanel />;
      case 'ranking':
        return <RankingPopup userId={user?.id} />;
      case 'profile':
        return renderProfileTab();
      default:
        return renderHomeTab();
    }
  };

  return (
    <div className="h-full w-full light-bg relative overflow-hidden">
      {/* Tab Content */}
      <div className="h-full relative z-10">
        {renderTabContent()}
      </div>

      {/* Bottom Navigation */}
      <BottomNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        isLoggedIn={!!user}
      />

      {/* Settings Popup */}
      {showSettings && (
        <SettingsPopup onClose={() => setShowSettings(false)} />
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
              <p className="text-[2.8cqw] text-cream-700 mb-[2cqw]">招待コードで参加</p>
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
              <p className="text-[2.8cqw] text-cream-700 mb-[2cqw]">新しいテーブルを作成</p>
              <div className="flex gap-[2cqw] mb-[2.5cqw]">
                {([6, 9] as const).map(count => (
                  <button
                    key={count}
                    onClick={() => setPrivateSeatCount(count)}
                    className={`flex-1 py-[2cqw] text-[3cqw] rounded-[2cqw] font-bold border transition-all ${
                      privateSeatCount === count
                        ? 'bg-forest text-white border-forest'
                        : 'bg-cream-50 text-cream-700 border-cream-300'
                    }`}
                  >
                    {count}人卓
                  </button>
                ))}
              </div>
              <button
                onClick={() => { onCreatePrivate('1/3', privateSeatCount); setShowPrivateDialog(false); }}
                disabled={!!maintenance?.isActive}
                className="w-full py-[3cqw] text-[3.5cqw] bg-cream-800 text-white rounded-[2cqw] font-bold disabled:opacity-40 transition-all active:scale-[0.97] shadow-[0_4px_12px_rgba(139,126,106,0.3)]"
              >
                PLO 1/3 テーブルを作成
              </button>
            </div>

            {/* 閉じるボタン */}
            <button
              onClick={() => setShowPrivateDialog(false)}
              className="mt-[4cqw] w-full py-[2.5cqw] text-[3cqw] text-cream-700 hover:text-cream-900 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
