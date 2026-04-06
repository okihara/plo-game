import { useEffect, useState } from 'react';
import { useTournamentState, TournamentLobbyInfo } from '../hooks/useTournamentState';
import { useAuth } from '../contexts/AuthContext';
import { Trophy, Clock, Loader2 } from 'lucide-react';
import { AlertDialogOverlay } from './AlertDialog';

interface TournamentListProps {
  onJoinTournament: (tournamentId: string) => void;
  onViewMyResult: (tournamentId: string) => void;
  onViewResults: (tournamentId: string) => void;
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
    case 'completed': return { text: '終了', color: 'bg-cream-400' };
    case 'cancelled': return { text: 'キャンセル', color: 'bg-cream-400' };
    default: return { text: status, color: 'bg-cream-500' };
  }
}

export function TournamentList({ onJoinTournament, onViewMyResult, onViewResults }: TournamentListProps) {
  const { user } = useAuth();
  const {
    tournaments,
    refreshList,
    isListLoading,
    registeredTournamentId,
    canReenterTournamentId,
    myFinishedTournamentIds,
    register,
    reenter,
    error,
  } = useTournamentState();

  const [registering, setRegistering] = useState<string | null>(null);
  const [reentering, setReentering] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (registeredTournamentId) {
      setRegistering(null);
      setReentering(null);
    }
  }, [registeredTournamentId]);

  const handleRegister = async (tournamentId: string) => {
    if (!user) return;
    setRegistering(tournamentId);
    const result = await register(tournamentId);
    if (!result.success) {
      setRegistering(null);
      setEntryError(result.error ?? '登録に失敗しました');
    }
  };

  const handleReenter = async (tournamentId: string) => {
    if (!user) return;
    setReentering(tournamentId);
    const result = await reenter(tournamentId);
    if (!result.success) {
      setReentering(null);
      setEntryError(result.error ?? 'リエントリーに失敗しました');
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {entryError && (
        <AlertDialogOverlay
          title="エントリー失敗"
          description={entryError}
          primaryLabel="OK"
          onPrimary={() => setEntryError(null)}
        />
      )}

      {/* Header */}
      <div className="shrink-0 flex items-center gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-300">
        <Trophy className="w-[5cqw] h-[5cqw] text-amber-500 shrink-0" />
        <h1 className="text-[4.5cqw] font-bold text-cream-900">トーナメント</h1>
      </div>

      {error && (
        <div className="shrink-0 mx-[4cqw] mt-[3cqw] px-[3cqw] py-[2cqw] bg-cream-50 border border-cream-400 rounded-[2cqw] text-[2.8cqw] text-cream-800">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {isListLoading && (
          <div className="flex items-center justify-center py-[20cqw]">
            <Loader2 className="w-[6cqw] h-[6cqw] animate-spin text-cream-700 shrink-0" />
            <span className="ml-[2cqw] text-[3cqw] text-cream-700">読み込み中...</span>
          </div>
        )}

        {!isListLoading && (
          <div className="px-[4cqw] py-[4cqw] space-y-[3cqw] pb-[6cqw]">
            {tournaments.length === 0 && (
              <div className="text-center py-[16cqw] text-[3cqw] text-cream-700">
                <Trophy className="w-[12cqw] h-[12cqw] mx-auto mb-[3cqw] opacity-30" />
                <p>トーナメントはありません</p>
              </div>
            )}

            {tournaments.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                isRegistered={registeredTournamentId === t.id}
                isRegistering={registering === t.id}
                canReenter={canReenterTournamentId === t.id}
                isReentering={reentering === t.id}
                isLoggedIn={!!user}
                hasParticipated={myFinishedTournamentIds.has(t.id)}
                onRegister={() => handleRegister(t.id)}
                onReenter={() => handleReenter(t.id)}
                onEnter={() => onJoinTournament(t.id)}
                onViewMyResult={() => onViewMyResult(t.id)}
                onViewResults={() => onViewResults(t.id)}
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
  canReenter,
  isReentering,
  isLoggedIn,
  hasParticipated,
  onRegister,
  onReenter,
  onEnter,
  onViewMyResult,
  onViewResults,
}: {
  tournament: TournamentLobbyInfo;
  isRegistered: boolean;
  isRegistering: boolean;
  canReenter: boolean;
  isReentering: boolean;
  isLoggedIn: boolean;
  hasParticipated: boolean;
  onRegister: () => void;
  onReenter: () => void;
  onEnter: () => void;
  onViewMyResult: () => void;
  onViewResults: () => void;
}) {
  const status = statusLabel(t.status);
  const isRunning = t.status !== 'waiting' && t.status !== 'completed' && t.status !== 'cancelled';
  const isFinished = t.status === 'completed' || t.status === 'cancelled';
  const isWaitingForStart = t.status === 'waiting' && t.scheduledStartTime && new Date(t.scheduledStartTime) > new Date();

  const showStartContext =
    !isFinished && !isRunning && (t.scheduledStartTime || t.startedAt);
  const startContextStrong = isWaitingForStart;

  return (
    <div className={`rounded-[2.5cqw] overflow-hidden ${
      isRunning
        ? 'bg-amber-50 border-[0.5cqw] border-amber-500 shadow-[0_2px_12px_rgba(180,120,30,0.25)]'
        : 'bg-white border border-cream-300 shadow-[0_2px_8px_rgba(139,126,106,0.12)]'
    }`}>
      <div className={`px-[4cqw] py-[3cqw] border-b ${
        isRunning ? 'bg-gradient-to-b from-amber-500 to-amber-600 text-white border-amber-600' : 'border-cream-200'
      }`}>
        <div className="flex items-center gap-[2cqw] min-w-0">
          <Trophy className={`w-[4.5cqw] h-[4.5cqw] shrink-0 ${isRunning ? 'text-white' : 'text-amber-500'}`} />
          <span className={`font-bold text-[5cqw] leading-snug truncate ${isRunning ? 'text-white' : 'text-cream-900'}`}>{t.name}</span>
        </div>
        <div className="flex items-center gap-[1.5cqw] mt-[1.5cqw] pl-[6.5cqw]">
          <span className={`px-[2cqw] py-[0.5cqw] rounded-full text-[2.5cqw] font-medium ${
            isRunning ? 'bg-white text-amber-700' : `text-white ${status.color}`
          }`}>
            {status.text}
          </span>
          {t.isRegistrationOpen && !isFinished && (
            <span className={`px-[1.8cqw] py-[0.35cqw] rounded-full text-[2.2cqw] font-semibold ${
              isRunning
                ? 'bg-white/20 text-white border border-white/40'
                : 'bg-forest/10 text-forest border border-forest/25'
            }`}>
              参加可能
            </span>
          )}
        </div>
      </div>

      <div className="px-[4cqw] pt-[3cqw] grid grid-cols-3 gap-x-[2cqw]">
        <div className="min-w-0">
          <div className="text-[2.2cqw] uppercase tracking-wide text-cream-700 truncate">バイイン</div>
          <div className="text-[4.2cqw] font-bold tabular-nums text-cream-900 leading-tight mt-[0.4cqw]">
            {t.buyIn.toLocaleString()}
          </div>
        </div>
        <div className="min-w-0 text-center">
          <div className="text-[2.2cqw] uppercase tracking-wide text-cream-700">参加</div>
          <div className="text-[4.2cqw] font-bold tabular-nums text-cream-900 leading-tight mt-[0.4cqw]">
            {t.registeredPlayers}
            <span className="text-[2.8cqw] font-semibold text-cream-700">
              /{t.maxPlayers}
            </span>
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-[2.2cqw] uppercase tracking-wide text-cream-700 truncate">賞金</div>
          <div className="text-[4.2cqw] font-bold tabular-nums text-forest leading-tight mt-[0.4cqw]">
            {t.prizePool.toLocaleString()}
          </div>
        </div>
      </div>

      {(isRunning || showStartContext) && (
        <div className="px-[4cqw] pt-[2.5cqw]">
          {isRunning ? (
            <div className="flex items-center justify-center text-[3cqw] font-semibold text-cream-800 bg-cream-100 rounded-[1.5cqw] px-[2.5cqw] py-[1.8cqw]">
              ブラインド Lv.{t.currentBlindLevel}
            </div>
          ) : showStartContext ? (
            <div
              className={`flex items-center justify-center gap-[1.5cqw] text-[3cqw] font-semibold text-cream-800 rounded-[1.5cqw] px-[2.5cqw] py-[1.8cqw] ${
                startContextStrong
                  ? 'bg-cream-100 ring-1 ring-cream-300/80'
                  : 'bg-cream-50'
              }`}
            >
              <Clock className="w-[3.5cqw] h-[3.5cqw] shrink-0 opacity-80" />
              開始 {formatTime(t.startedAt ?? t.scheduledStartTime)}
            </div>
          ) : null}
        </div>
      )}

      <div className="px-[4cqw] pt-[2.5cqw] pb-[3cqw] space-y-[1cqw] text-[2.6cqw] text-cream-700 border-b border-cream-100">
        <div className="flex justify-between gap-[3cqw]">
          <span>初期チップ</span>
          <span className="shrink-0 tabular-nums font-medium text-cream-800">
            {t.startingChips.toLocaleString()}
          </span>
        </div>
        {t.allowReentry && (
          <div className="flex justify-between gap-[3cqw]">
            <span className="shrink-0">リエントリー</span>
            <span className="text-right font-medium text-cream-800">
              最大 {t.maxReentries}回（Lv.{t.reentryDeadlineLevel}まで）
            </span>
          </div>
        )}
        {t.allowReentry && t.totalReentries > 0 && (
          <div className="text-[2.4cqw] text-cream-700 pt-[0.2cqw]">
            Reentry 利用 {t.totalReentries}回
          </div>
        )}
      </div>

      <div className="px-[4cqw] pb-[4cqw] pt-[1cqw]">
        {isFinished ? (
          <div className="flex gap-[2cqw]">
            {hasParticipated && (
              <button
                type="button"
                onClick={onViewMyResult}
                className="flex-1 py-[2.5cqw] bg-cream-900 hover:bg-cream-800 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors"
              >
                自分の結果を見る
              </button>
            )}
            <button
              type="button"
              onClick={onViewResults}
              className={`${hasParticipated ? 'flex-1' : 'w-full'} py-[2.5cqw] rounded-[2cqw] text-[3cqw] font-bold transition-colors border-[0.4cqw] border-cream-800 bg-cream-50 text-cream-900 hover:bg-cream-100 active:bg-cream-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]`}
            >
              結果を見る
            </button>
          </div>
        ) : isWaitingForStart ? (
          <div className="text-center text-[3cqw] text-cream-700 py-[2cqw]">
            開始時刻をお待ちください
          </div>
        ) : !isLoggedIn ? (
          <div className="text-center text-[3cqw] text-cream-700 py-[2cqw]">
            ログインすると参加できます
          </div>
        ) : isRegistered ? (
          <button
            type="button"
            onClick={onEnter}
            className="w-full py-[2.5cqw] bg-cream-900 hover:bg-cream-800 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors"
          >
            テーブルに入る
          </button>
        ) : canReenter ? (
          <button
            type="button"
            onClick={onReenter}
            disabled={isReentering}
            className="w-full py-[2.5cqw] bg-cream-900 hover:bg-cream-800 disabled:bg-cream-300 disabled:text-cream-500 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors flex items-center justify-center gap-[2cqw]"
          >
            {isReentering ? (
              <>
                <Loader2 className="w-[4cqw] h-[4cqw] animate-spin shrink-0" />
                リエントリー中...
              </>
            ) : (
              <>リエントリー ({t.buyIn.toLocaleString()} chips)</>
            )}
          </button>
        ) : t.isRegistrationOpen ? (
          <button
            type="button"
            onClick={onRegister}
            disabled={isRegistering}
            className="w-full py-[2.5cqw] bg-cream-900 hover:bg-cream-800 disabled:bg-cream-300 disabled:text-cream-500 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors flex items-center justify-center gap-[2cqw]"
          >
            {isRegistering ? (
              <>
                <Loader2 className="w-[4cqw] h-[4cqw] animate-spin shrink-0" />
                登録中...
              </>
            ) : (
              <>参加登録 ({t.buyIn.toLocaleString()} chips)</>
            )}
          </button>
        ) : (
          <div className="text-center text-[3cqw] text-cream-700 py-[2cqw]">
            進行中（登録締切済み）
          </div>
        )}
      </div>
    </div>
  );
}
