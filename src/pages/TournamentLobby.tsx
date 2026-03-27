import { useEffect, useState } from 'react';
import { useTournamentState, TournamentLobbyInfo } from '../hooks/useTournamentState';
import { useAuth } from '../contexts/AuthContext';
import { Trophy, Users, Clock, ChevronLeft, Loader2 } from 'lucide-react';
import { formatChips } from '../utils/formatChips';

interface TournamentLobbyProps {
  onJoinTournament: (tournamentId: string) => void;
  onBack: () => void;
}

function formatTime(isoString?: string): string {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function statusLabel(status: string): { text: string; color: string } {
  switch (status) {
    case 'waiting': return { text: '開始待ち', color: 'bg-forest' };
    case 'starting': return { text: '開始準備中', color: 'bg-cream-600' };
    case 'running': return { text: '進行中', color: 'bg-forest-light' };
    case 'final_table': return { text: 'ファイナルテーブル', color: 'bg-forest-dark' };
    case 'heads_up': return { text: 'ヘッズアップ', color: 'bg-cream-800' };
    default: return { text: status, color: 'bg-cream-500' };
  }
}

export function TournamentLobby({ onJoinTournament, onBack }: TournamentLobbyProps) {
  const { user } = useAuth();
  const {
    tournaments,
    refreshList,
    isListLoading,
    registeredTournamentId,
    register,
    error,
  } = useTournamentState();

  const [registering, setRegistering] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (registeredTournamentId) {
      setRegistering(null);
    }
  }, [registeredTournamentId]);

  const handleRegister = async (tournamentId: string) => {
    if (!user) return;
    setRegistering(tournamentId);
    const result = await register(tournamentId);
    if (!result.success) {
      setRegistering(null);
    }
  };

  const handleEnter = (tournamentId: string) => {
    onJoinTournament(tournamentId);
  };

  return (
    <div className="h-full w-full light-bg text-cream-900 flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 flex items-center gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-300">
        <button
          type="button"
          onClick={onBack}
          className="p-[1.5cqw] rounded-[2cqw] hover:bg-cream-200 transition-colors"
        >
          <ChevronLeft className="w-[5cqw] h-[5cqw]" />
        </button>
        <Trophy className="w-[5cqw] h-[5cqw] text-forest shrink-0" />
        <h1 className="text-[4.5cqw] font-bold">トーナメント</h1>
      </div>

      {error && (
        <div className="shrink-0 mx-[4cqw] mt-[3cqw] px-[3cqw] py-[2cqw] bg-cream-50 border border-cream-400 rounded-[2cqw] text-[2.8cqw] text-cream-800">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isListLoading && (
          <div className="flex items-center justify-center py-[20cqw]">
            <Loader2 className="w-[6cqw] h-[6cqw] animate-spin text-cream-500 shrink-0" />
            <span className="ml-[2cqw] text-[3cqw] text-cream-500">読み込み中...</span>
          </div>
        )}

        {!isListLoading && (
          <div className="px-[4cqw] py-[4cqw] space-y-[3cqw] pb-[6cqw]">
            {tournaments.length === 0 && (
              <div className="text-center py-[16cqw] text-[3cqw] text-cream-500">
                <Trophy className="w-[12cqw] h-[12cqw] mx-auto mb-[3cqw] opacity-30" />
                <p>開催中のトーナメントはありません</p>
              </div>
            )}

            {tournaments.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                isRegistered={registeredTournamentId === t.id}
                isRegistering={registering === t.id}
                isLoggedIn={!!user}
                onRegister={() => handleRegister(t.id)}
                onEnter={() => handleEnter(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TournamentCard({
  tournament: t,
  isRegistered,
  isRegistering,
  isLoggedIn,
  onRegister,
  onEnter,
}: {
  tournament: TournamentLobbyInfo;
  isRegistered: boolean;
  isRegistering: boolean;
  isLoggedIn: boolean;
  onRegister: () => void;
  onEnter: () => void;
}) {
  const status = statusLabel(t.status);
  const isRunning = t.status !== 'waiting';

  return (
    <div className="bg-white rounded-[2.5cqw] border border-cream-300 shadow-[0_2px_8px_rgba(139,126,106,0.12)] overflow-hidden">
      <div className="px-[4cqw] py-[3cqw] flex items-center justify-between gap-[2cqw]">
        <div className="flex items-center gap-[2cqw] min-w-0">
          <Trophy className="w-[4cqw] h-[4cqw] text-forest shrink-0" />
          <span className="font-bold text-[3.5cqw] truncate">{t.name}</span>
        </div>
        <span className={`shrink-0 px-[2cqw] py-[0.5cqw] rounded-full text-[2.5cqw] font-medium text-white ${status.color}`}>
          {status.text}
        </span>
      </div>

      <div className="px-[4cqw] pb-[3cqw] grid grid-cols-2 gap-y-[1.5cqw] text-[3cqw]">
        <div className="text-cream-600 flex items-center gap-[1.5cqw]">
          <span>Buy-in</span>
        </div>
        <div className="text-right font-medium">{formatChips(t.buyIn)}</div>

        <div className="text-cream-600 flex items-center gap-[1.5cqw]">
          <span>初期チップ</span>
        </div>
        <div className="text-right font-medium">{formatChips(t.startingChips)}</div>

        <div className="text-cream-600 flex items-center gap-[1.5cqw]">
          <Users className="w-[3.5cqw] h-[3.5cqw] shrink-0" />
          <span>参加者</span>
        </div>
        <div className="text-right font-medium">{t.registeredPlayers} / {t.maxPlayers}</div>

        <div className="text-cream-600 flex items-center gap-[1.5cqw]">
          <Trophy className="w-[3.5cqw] h-[3.5cqw] shrink-0" />
          <span>賞金プール</span>
        </div>
        <div className="text-right font-medium text-forest font-bold">{formatChips(t.prizePool)}</div>

        {t.scheduledStartTime && (
          <>
            <div className="text-cream-600 flex items-center gap-[1.5cqw]">
              <Clock className="w-[3.5cqw] h-[3.5cqw] shrink-0" />
              <span>開始時刻</span>
            </div>
            <div className="text-right font-medium">{formatTime(t.scheduledStartTime)}</div>
          </>
        )}

        {isRunning && (
          <>
            <div className="text-cream-600">ブラインドLv</div>
            <div className="text-right font-medium">Lv.{t.currentBlindLevel}</div>
          </>
        )}

        {t.isRegistrationOpen && (
          <div className="col-span-2 text-[2.5cqw] text-forest mt-[1cqw]">遅刻登録可能</div>
        )}
      </div>

      <div className="px-[4cqw] pb-[4cqw]">
        {!isLoggedIn ? (
          <div className="text-center text-[3cqw] text-cream-500 py-[2cqw]">
            ログインすると参加できます
          </div>
        ) : isRegistered ? (
          <button
            type="button"
            onClick={onEnter}
            className="w-full py-[2.5cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors"
          >
            テーブルに入る
          </button>
        ) : t.isRegistrationOpen ? (
          <button
            type="button"
            onClick={onRegister}
            disabled={isRegistering}
            className="w-full py-[2.5cqw] bg-forest hover:bg-forest-light disabled:bg-cream-300 disabled:text-cream-500 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors flex items-center justify-center gap-[2cqw]"
          >
            {isRegistering ? (
              <>
                <Loader2 className="w-[4cqw] h-[4cqw] animate-spin shrink-0" />
                登録中...
              </>
            ) : (
              <>参加登録 ({formatChips(t.buyIn)} chips)</>
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onEnter}
            className="w-full py-[2.5cqw] bg-cream-200 hover:bg-cream-300 text-cream-800 rounded-[2cqw] text-[3cqw] transition-colors"
          >
            観戦する
          </button>
        )}
      </div>
    </div>
  );
}
