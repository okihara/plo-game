import { useEffect, useState } from 'react';
import { useTournamentState, TournamentLobbyInfo } from '../hooks/useTournamentState';
import {
  useTournamentEvaluations,
  type TournamentEvalEligibleMeta,
  type TournamentEvalQuota,
} from '../hooks/useTournamentEvaluations';
import { useAuth } from '../contexts/AuthContext';
import { Trophy, Clock, Loader2 } from 'lucide-react';
import { AlertDialogOverlay } from './AlertDialog';
import { TournamentEvaluationPopup } from './TournamentEvaluationPopup';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface TournamentListProps {
  onJoinTournament: (tournamentId: string) => void;
  onViewMyResult: (tournamentId: string) => void;
  onViewResults: (tournamentId: string) => void;
  onWatchFinalTable: (tournamentId: string, tableId: string) => void;
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

export function TournamentList({ onJoinTournament, onViewMyResult, onViewResults, onWatchFinalTable }: TournamentListProps) {
  const { user } = useAuth();
  const {
    tournaments,
    refreshList,
    isListLoading,
    registeredTournamentId,
    canReenterTournamentId,
    myEliminatedTournamentId,
    myFinishedTournamentIds,
    register,
    reenter,
    error,
  } = useTournamentState();

  const [registering, setRegistering] = useState<string | null>(null);
  const [reentering, setReentering] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [generatingEvalTournamentId, setGeneratingEvalTournamentId] = useState<string | null>(null);
  const [evalViewPopup, setEvalViewPopup] = useState<{ id: string; title: string } | null>(null);
  const [evalSubmitError, setEvalSubmitError] = useState<{ tournamentId: string; message: string } | null>(null);

  const { quota: evalQuota, eligible: evalEligible, loading: evalMetaLoading, refresh: refreshEvalMeta } =
    useTournamentEvaluations(!!user);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (user) void refreshEvalMeta();
  }, [user, refreshEvalMeta]);

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

  const handleEvalGenerate = async (tournamentId: string) => {
    setEvalSubmitError(null);
    setGeneratingEvalTournamentId(tournamentId);
    try {
      const res = await fetch(`${API_BASE}/api/tournament-evaluations/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tournamentId }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        if (
          res.status === 409 &&
          (data.code === 'EVAL_ALREADY_GENERATING' || data.code === 'EVAL_BUSY_OTHER_TOURNAMENT')
        ) {
          await refreshEvalMeta();
          return;
        }
        let msg = '生成に失敗しました';
        if (res.status === 429) msg = '本日の生成回数に達しました（日本時間で翌日に再試行できます）';
        else if (res.status === 503) msg = 'AIレビューβは現在利用できません';
        else if (typeof data.error === 'string') msg = data.error;
        setEvalSubmitError({ tournamentId, message: msg });
        return;
      }
      await refreshEvalMeta();
    } catch {
      setEvalSubmitError({ tournamentId, message: '通信エラーが発生しました' });
    } finally {
      setGeneratingEvalTournamentId(null);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <TournamentEvaluationPopup
        open={evalViewPopup !== null}
        tournamentId={evalViewPopup?.id ?? null}
        title={evalViewPopup?.title ?? ''}
        onClose={() => setEvalViewPopup(null)}
      />
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
          <div className="px-[4cqw] py-[4cqw] space-y-[3cqw] pb-[18cqw]">
            {tournaments.length === 0 && (
              <div className="text-center py-[16cqw] text-[3cqw] text-cream-700">
                <Trophy className="w-[12cqw] h-[12cqw] mx-auto mb-[3cqw] opacity-30" />
                <p>トーナメントはありません</p>
              </div>
            )}

            {tournaments.map((t) => {
              const evalMeta: TournamentEvalEligibleMeta | null | undefined = !user
                ? null
                : evalMetaLoading
                  ? undefined
                  : evalEligible.find((e) => e.id === t.id) ?? null;
              const evalGenerateBlockedElsewhere =
                (generatingEvalTournamentId !== null && generatingEvalTournamentId !== t.id) ||
                evalEligible.some((e) => e.id !== t.id && e.evaluationPending === true);
              return (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  winner={t.winner ?? null}
                  isRegistered={registeredTournamentId === t.id}
                  isRegistering={registering === t.id}
                  canReenter={canReenterTournamentId === t.id}
                  isReentering={reentering === t.id}
                  isLoggedIn={!!user}
                  hasParticipated={myFinishedTournamentIds.has(t.id)}
                  isEliminated={myEliminatedTournamentId === t.id}
                  onRegister={() => handleRegister(t.id)}
                  onReenter={() => handleReenter(t.id)}
                  onEnter={() => onJoinTournament(t.id)}
                  onViewMyResult={() => onViewMyResult(t.id)}
                  onViewResults={() => onViewResults(t.id)}
                  onWatchFinalTable={t.finalTableId ? () => onWatchFinalTable(t.id, t.finalTableId!) : undefined}
                  evalEligibleMeta={evalMeta}
                  evalQuota={evalQuota}
                  isEvalGenerating={
                    generatingEvalTournamentId === t.id || evalMeta?.evaluationPending === true
                  }
                  evalGenerateBlockedElsewhere={evalGenerateBlockedElsewhere}
                  evalErrorMessage={evalSubmitError?.tournamentId === t.id ? evalSubmitError.message : null}
                  onEvalGenerate={() => handleEvalGenerate(t.id)}
                  onEvalViewResult={() => setEvalViewPopup({ id: t.id, title: t.name })}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function TournamentCard({
  tournament: t,
  winner,
  isRegistered,
  isRegistering,
  canReenter,
  isReentering,
  isLoggedIn,
  hasParticipated,
  isEliminated,
  onRegister,
  onReenter,
  onEnter,
  onViewMyResult,
  onViewResults,
  onWatchFinalTable,
  evalEligibleMeta,
  evalQuota,
  isEvalGenerating,
  evalGenerateBlockedElsewhere,
  evalErrorMessage,
  onEvalGenerate,
  onEvalViewResult,
}: {
  tournament: TournamentLobbyInfo;
  /** 完了トナメの優勝者。displayName はサーバー側でマスク済みを想定。 */
  winner?: { displayName: string; avatarUrl?: string | null } | null;
  isRegistered: boolean;
  isRegistering: boolean;
  canReenter: boolean;
  isReentering: boolean;
  isLoggedIn: boolean;
  hasParticipated: boolean;
  isEliminated: boolean;
  onRegister: () => void;
  onReenter: () => void;
  onEnter: () => void;
  onViewMyResult: () => void;
  onViewResults: () => void;
  /** FT中(または heads_up)のときのみ渡す。undefined の時はボタン非表示。 */
  onWatchFinalTable?: () => void;
  evalEligibleMeta: TournamentEvalEligibleMeta | null | undefined;
  evalQuota: TournamentEvalQuota | null;
  isEvalGenerating: boolean;
  /** 別トナメで生成リクエスト中（ローカル or サーバー PENDING） */
  evalGenerateBlockedElsewhere: boolean;
  evalErrorMessage: string | null;
  onEvalGenerate: () => void;
  onEvalViewResult: () => void;
}) {
  const status = statusLabel(t.status);
  const isRunning = t.status !== 'waiting' && t.status !== 'completed' && t.status !== 'cancelled';
  const isFinished = t.status === 'completed' || t.status === 'cancelled';
  const isWaitingForStart = t.status === 'waiting' && t.scheduledStartTime && new Date(t.scheduledStartTime) > new Date();
  const showLateDeadline = Boolean(
    isRunning &&
      t.isRegistrationOpen &&
      t.registrationDeadlineAt &&
      new Date(t.registrationDeadlineAt) > new Date(),
  );
  const showWinnerHero = t.status === 'completed' && !!winner;

  return (
    <div
      className={`rounded-[3cqw] overflow-hidden bg-white border border-cream-300 shadow-[0_2px_10px_rgba(139,126,106,0.15)] ${
        isRunning ? 'ring-[0.4cqw] ring-amber-400' : ''
      }`}
    >
      {/* Header: 名前 + ステータスバッジ */}
      <div className="px-[4cqw] pt-[3cqw] pb-[2cqw]">
        <div className="flex items-start gap-[2cqw] min-w-0">
          <Trophy className="w-[4.5cqw] h-[4.5cqw] shrink-0 text-amber-500 mt-[0.4cqw]" />
          <span className="font-bold text-[4.8cqw] leading-tight text-cream-900 truncate flex-1 min-w-0">
            {t.name}
          </span>
        </div>
        <div className="mt-[1.5cqw] pl-[6.5cqw] flex items-center gap-[1.5cqw]">
          <span
            className={`px-[1.8cqw] py-[0.4cqw] rounded-full text-[2.4cqw] font-medium text-white ${status.color}`}
          >
            {status.text}
          </span>
          {t.isRegistrationOpen && !isFinished && (
            <span className="px-[1.8cqw] py-[0.4cqw] rounded-full text-[2.3cqw] font-semibold bg-forest/10 text-forest border border-forest/25">
              参加可能
            </span>
          )}
        </div>
      </div>

      {/* Tier 1: state 別 hero */}
      {showWinnerHero && winner && (
        <div className="mx-[4cqw] mb-[2cqw] p-[3cqw] rounded-[2.5cqw] bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-300 flex items-center gap-[3cqw]">
          {winner.avatarUrl ? (
            <img
              src={winner.avatarUrl}
              alt=""
              className="w-[13cqw] h-[13cqw] rounded-full object-cover border-[0.4cqw] border-amber-400 shrink-0"
            />
          ) : (
            <div className="w-[13cqw] h-[13cqw] rounded-full bg-amber-200 border-[0.4cqw] border-amber-400 flex items-center justify-center text-[6cqw] shrink-0">
              🏆
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[4cqw] font-bold text-amber-700 tracking-wide">1st</div>
            <div className="text-[4.8cqw] font-bold text-cream-900 truncate leading-tight mt-[0.3cqw]">
              {winner.displayName}
            </div>
          </div>
        </div>
      )}

      {isRunning && (
        <div className="mx-[4cqw] mb-[2cqw] p-[3cqw] rounded-[2.5cqw] bg-amber-50 border border-amber-300 flex items-end justify-between gap-[2cqw]">
          <div className="flex items-baseline gap-[1.5cqw] min-w-0">
            <span className="text-[2.8cqw] text-amber-800 font-semibold">ブラインド Lv.</span>
            <span className="text-[8cqw] font-bold text-amber-700 tabular-nums leading-none">
              {t.currentBlindLevel}
            </span>
          </div>
          {showLateDeadline ? (
            <div className="text-right shrink-0">
              <div className="text-[2.2cqw] text-cream-700 uppercase tracking-wide">レイト締切</div>
              <div className="text-[3.8cqw] font-bold text-cream-900 tabular-nums leading-tight">
                {formatTime(t.registrationDeadlineAt)}
              </div>
            </div>
          ) : !t.isRegistrationOpen ? (
            <div className="text-[3cqw] font-bold text-cream-700 shrink-0">締切済み</div>
          ) : null}
        </div>
      )}

      {t.status === 'waiting' && (
        <div className="mx-[4cqw] mb-[2cqw] p-[3cqw] rounded-[2.5cqw] bg-cream-50 border border-cream-200">
          <div className="text-[2.3cqw] tracking-wide text-cream-700 flex items-center gap-[1cqw]">
            <Clock className="w-[2.6cqw] h-[2.6cqw] opacity-70" />
            <span>{isWaitingForStart ? '開始予定' : '開始'}</span>
          </div>
          <div className="text-[6cqw] font-bold text-cream-900 tabular-nums leading-tight mt-[0.3cqw]">
            {formatTime(t.scheduledStartTime)}
          </div>
        </div>
      )}

      {/* Tier 2: コンパクトな主要情報 */}
      <div className="px-[4cqw] flex items-baseline gap-[3.5cqw] text-[3cqw] flex-wrap">
        {!isFinished && (
          <div>
            <span className="text-cream-600">エントリー費 </span>
            <span className="font-semibold tabular-nums text-cream-900">{t.buyIn.toLocaleString()}</span>
          </div>
        )}
        {t.status !== 'cancelled' && (
          <div>
            <span className="text-cream-600">賞金 </span>
            <span className="font-semibold tabular-nums text-forest">{t.prizePool.toLocaleString()}</span>
          </div>
        )}
        <div>
          <span className="text-cream-600">参加 </span>
          <span className="font-semibold tabular-nums text-cream-900">{t.registeredPlayers}</span>
          <span className="text-cream-600">/{t.maxPlayers}</span>
        </div>
      </div>

      {/* Tier 3: 詳細（小） */}
      <div className="px-[4cqw] pt-[1cqw] pb-[2cqw] text-[2.8cqw] text-cream-700 flex flex-wrap gap-x-[3cqw] gap-y-[0.3cqw]">
        <span>
          初期 <span className="tabular-nums font-medium text-cream-800">{t.startingChips.toLocaleString()}</span>
        </span>
        {t.allowReentry && (
          <span>
            Reentry 最大{t.maxReentries}回 (Lv.{t.reentryDeadlineLevel})
          </span>
        )}
        {t.allowReentry && t.totalReentries > 0 && (
          <span>利用 {t.totalReentries}回</span>
        )}
      </div>

      <div className="px-[4cqw] pb-[4cqw] pt-[1cqw] space-y-[2cqw]">
        {isFinished ? (
          <div className="space-y-[2cqw]">
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
            {isLoggedIn && t.status === 'completed' && evalEligibleMeta !== null && (
              <div className="pt-[1cqw] border-t border-cream-100">
                {evalEligibleMeta === undefined ? (
                  <div className="py-[2cqw] text-center text-[2.6cqw] text-cream-500">AIレビューβ…</div>
                ) : (
                  <>
                    {evalErrorMessage && (
                      <p className="text-red-700 text-[2.5cqw] mb-[1.5cqw] leading-snug">{evalErrorMessage}</p>
                    )}
                    {isEvalGenerating ? (
                      <button
                        type="button"
                        disabled
                        className="w-full py-[2.2cqw] rounded-[2cqw] text-[3cqw] font-bold bg-cream-200 text-cream-600 flex items-center justify-center gap-[2cqw]"
                      >
                        <Loader2 className="w-[4cqw] h-[4cqw] animate-spin shrink-0" />
                        AIレビューβを生成中
                      </button>
                    ) : evalEligibleMeta.latestEvaluationAt ? (
                      <button
                        type="button"
                        onClick={onEvalViewResult}
                        className="w-full py-[2.2cqw] rounded-[2cqw] text-[3cqw] font-bold bg-forest text-white hover:bg-forest/90 transition-colors"
                      >
                        AIレビューβの結果を閲覧
                      </button>
                    ) : evalGenerateBlockedElsewhere ? (
                      <button
                        type="button"
                        disabled
                        className="w-full py-[2.2cqw] rounded-[2cqw] text-[2.8cqw] font-semibold bg-cream-100 text-cream-500"
                      >
                        別のトーナメントでAIレビューβを生成中
                      </button>
                    ) : evalQuota?.canGenerateToday && evalQuota?.llmConfigured ? (
                      <button
                        type="button"
                        onClick={onEvalGenerate}
                        className="w-full py-[2.2cqw] rounded-[2cqw] text-[3cqw] font-bold bg-cream-800 text-white hover:bg-cream-700 transition-colors"
                      >
                        AIレビューβを生成（1日1回）
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="w-full py-[2.2cqw] rounded-[2cqw] text-[2.8cqw] font-semibold bg-cream-100 text-cream-500"
                      >
                        {!evalQuota?.llmConfigured ? 'AIレビューβは利用できません' : 'AIレビューβ(本日使用済)'}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
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
        ) : t.isRegistrationOpen && !isEliminated ? (
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
        ) : isEliminated ? (
          <button
            type="button"
            onClick={onViewMyResult}
            className="w-full py-[2.5cqw] bg-cream-900 hover:bg-cream-800 text-white rounded-[2cqw] font-bold text-[3cqw] transition-colors"
          >
            自分の結果を見る
          </button>
        ) : (
          <div className="text-center text-[3cqw] text-cream-700 py-[2cqw]">
            進行中（登録締切済み）
          </div>
        )}
        {onWatchFinalTable && (
          <button
            type="button"
            onClick={onWatchFinalTable}
            className="w-full py-[2.2cqw] rounded-[2cqw] text-[3cqw] font-bold border-[0.4cqw] border-cream-800 bg-cream-50 text-cream-900 hover:bg-cream-100 active:bg-cream-200 transition-colors"
          >
            FT観戦
          </button>
        )}
      </div>
    </div>
  );
}
