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
    case 'registering': return { text: '登録受付中', color: 'bg-green-500' };
    case 'starting': return { text: '開始準備中', color: 'bg-yellow-500' };
    case 'running': return { text: '進行中', color: 'bg-blue-500' };
    case 'final_table': return { text: 'ファイナルテーブル', color: 'bg-purple-500' };
    case 'heads_up': return { text: 'ヘッズアップ', color: 'bg-red-500' };
    default: return { text: status, color: 'bg-gray-500' };
  }
}

export function TournamentLobby({ onJoinTournament, onBack }: TournamentLobbyProps) {
  const { user } = useAuth();
  const {
    isConnected,
    isConnecting,
    connect,
    tournaments,
    refreshList,
    isRegistered,
    registeredTournamentId,
    register,
    unregister,
    error,
  } = useTournamentState();

  const [registering, setRegistering] = useState<string | null>(null);

  // 接続 + 一覧取得
  useEffect(() => {
    connect().then(() => refreshList());
  }, [connect, refreshList]);

  // 定期更新
  useEffect(() => {
    if (!isConnected) return;
    const interval = setInterval(refreshList, 5000);
    return () => clearInterval(interval);
  }, [isConnected, refreshList]);

  // 登録完了 → ゲーム画面へ遷移
  useEffect(() => {
    if (isRegistered && registeredTournamentId) {
      setRegistering(null);
    }
  }, [isRegistered, registeredTournamentId]);

  const handleRegister = (tournamentId: string) => {
    if (!user) return;
    setRegistering(tournamentId);
    register(tournamentId);
  };

  const handleUnregister = (tournamentId: string) => {
    unregister(tournamentId);
  };

  const handleEnter = (tournamentId: string) => {
    onJoinTournament(tournamentId);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-800 transition-colors">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <Trophy className="w-5 h-5 text-yellow-400" />
        <h1 className="text-lg font-bold">トーナメント</h1>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 bg-red-900/50 border border-red-700 rounded-lg text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Loading */}
      {isConnecting && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-400">接続中...</span>
        </div>
      )}

      {/* Tournament List */}
      {!isConnecting && (
        <div className="px-4 py-4 space-y-3">
          {tournaments.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <Trophy className="w-12 h-12 mx-auto mb-3 opacity-30" />
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
              onUnregister={() => handleUnregister(t.id)}
              onEnter={() => handleEnter(t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TournamentCard({
  tournament: t,
  isRegistered,
  isRegistering,
  isLoggedIn,
  onRegister,
  onUnregister,
  onEnter,
}: {
  tournament: TournamentLobbyInfo;
  isRegistered: boolean;
  isRegistering: boolean;
  isLoggedIn: boolean;
  onRegister: () => void;
  onUnregister: () => void;
  onEnter: () => void;
}) {
  const status = statusLabel(t.status);
  const isRunning = t.status !== 'registering';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Title + Status */}
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-yellow-400" />
          <span className="font-bold">{t.name}</span>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${status.color}`}>
          {status.text}
        </span>
      </div>

      {/* Details */}
      <div className="px-4 pb-3 grid grid-cols-2 gap-y-1.5 text-sm">
        <div className="text-gray-400 flex items-center gap-1.5">
          <span>Buy-in</span>
        </div>
        <div className="text-right font-medium">{formatChips(t.buyIn)}</div>

        <div className="text-gray-400 flex items-center gap-1.5">
          <span>初期チップ</span>
        </div>
        <div className="text-right font-medium">{formatChips(t.startingChips)}</div>

        <div className="text-gray-400 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>参加者</span>
        </div>
        <div className="text-right font-medium">{t.registeredPlayers} / {t.maxPlayers}</div>

        <div className="text-gray-400 flex items-center gap-1.5">
          <Trophy className="w-3.5 h-3.5" />
          <span>賞金プール</span>
        </div>
        <div className="text-right font-medium text-yellow-400">{formatChips(t.prizePool)}</div>

        {t.scheduledStartTime && (
          <>
            <div className="text-gray-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>開始時刻</span>
            </div>
            <div className="text-right font-medium">{formatTime(t.scheduledStartTime)}</div>
          </>
        )}

        {isRunning && (
          <>
            <div className="text-gray-400">ブラインドLv</div>
            <div className="text-right font-medium">Lv.{t.currentBlindLevel}</div>
          </>
        )}

        {t.isLateRegistrationOpen && (
          <div className="col-span-2 text-xs text-green-400 mt-1">遅刻登録可能</div>
        )}
      </div>

      {/* Action */}
      <div className="px-4 pb-4">
        {!isLoggedIn ? (
          <div className="text-center text-sm text-gray-500 py-2">
            ログインすると参加できます
          </div>
        ) : isRegistered ? (
          <div className="flex gap-2">
            <button
              onClick={onEnter}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-sm transition-colors"
            >
              テーブルに入る
            </button>
            {!isRunning && (
              <button
                onClick={onUnregister}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
              >
                取消
              </button>
            )}
          </div>
        ) : t.status === 'registering' || t.isLateRegistrationOpen ? (
          <button
            onClick={onRegister}
            disabled={isRegistering}
            className="w-full py-2.5 bg-yellow-600 hover:bg-yellow-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-bold text-sm transition-colors flex items-center justify-center gap-2"
          >
            {isRegistering ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                登録中...
              </>
            ) : (
              <>参加登録 ({formatChips(t.buyIn)} chips)</>
            )}
          </button>
        ) : (
          <button
            onClick={onEnter}
            className="w-full py-2.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors"
          >
            観戦する
          </button>
        )}
      </div>
    </div>
  );
}
