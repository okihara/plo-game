import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface TournamentEvaluationPopupProps {
  open: boolean;
  tournamentId: string | null;
  title: string;
  onClose: () => void;
}

export function TournamentEvaluationPopup({
  open,
  tournamentId,
  title,
  onClose,
}: TournamentEvaluationPopupProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !tournamentId) {
      setMarkdown(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setMarkdown(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/tournament-evaluations/by-tournament/${encodeURIComponent(tournamentId)}`,
          { credentials: 'include' }
        );
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? '保存された評価が見つかりません' : '読み込みに失敗しました');
          return;
        }
        const data = (await res.json()) as { content?: { markdown?: string } };
        setMarkdown(data.content?.markdown ?? null);
      } catch {
        if (!cancelled) setError('通信エラーが発生しました');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tournamentId]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-[4cqw]">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="閉じる"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-lg max-h-[85dvh] sm:max-h-[80vh] flex flex-col bg-white rounded-t-[3cqw] sm:rounded-[2.5cqw] shadow-xl border border-cream-300 overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-eval-popup-title"
      >
        <div className="shrink-0 flex items-center justify-between gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-200 bg-cream-50">
          <h2 id="tournament-eval-popup-title" className="text-[3.5cqw] font-bold text-cream-900 truncate pr-[2cqw]">
            AIレビューβ — {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 px-[3cqw] py-[1.5cqw] text-[3cqw] font-semibold text-cream-700 hover:text-cream-900 rounded-[1.5cqw] hover:bg-cream-200/80"
          >
            閉じる
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto light-scrollbar px-[4cqw] py-[3cqw]">
          {loading && (
            <div className="flex justify-center py-[12cqw]">
              <div className="w-[7cqw] h-[7cqw] border-[0.4cqw] border-cream-300 border-t-forest rounded-full animate-spin" />
            </div>
          )}
          {error && !loading && <p className="text-red-700 text-[3cqw]">{error}</p>}
          {!loading && !error && markdown && (
            <div className="text-cream-900 text-[3cqw] whitespace-pre-wrap leading-relaxed">{markdown}</div>
          )}
          {!loading && !error && !markdown && (
            <p className="text-cream-600 text-[3cqw]">表示できる内容がありません</p>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
