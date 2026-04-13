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

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const viewport = document.getElementById('plo-viewport');
  if (!viewport) return null;

  const shell = (
    <div
      className="absolute inset-0 z-[280] flex flex-col light-bg min-h-0 h-full"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tournament-eval-popup-title"
    >
      <div className="shrink-0 sticky top-0 bg-white border-b border-cream-300 px-[4cqw] py-[3cqw] z-10 shadow-sm">
        <h2
          id="tournament-eval-popup-title"
          className="text-cream-900 font-bold text-[4cqw] tracking-tight leading-snug truncate"
        >
          AIレビューβ — {title}
        </h2>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain light-scrollbar bg-white px-[4cqw] py-[3cqw] pb-[4cqw]">
        {loading && (
          <div className="flex flex-col items-center justify-center py-[12cqw]">
            <div className="w-[7cqw] h-[7cqw] border-[0.4cqw] border-cream-300 border-t-forest rounded-full animate-spin" />
            <p className="text-cream-700 text-[3cqw] mt-[3cqw]">読み込み中…</p>
          </div>
        )}
        {error && !loading && <p className="text-red-700 text-[3cqw] leading-relaxed">{error}</p>}
        {!loading && !error && markdown && (
          <div className="text-cream-900 text-[3cqw] whitespace-pre-wrap leading-relaxed">{markdown}</div>
        )}
        {!loading && !error && !markdown && (
          <p className="text-cream-600 text-[3cqw]">表示できる内容がありません</p>
        )}
      </div>

      <div className="shrink-0 border-t border-cream-300 bg-white px-[4cqw] pt-[1.8cqw] pb-[max(1.8cqw,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(139,126,106,0.08)]">
        <button
          type="button"
          onClick={onClose}
          className="w-full py-[2cqw] rounded-[2cqw] bg-forest text-white text-[3.2cqw] font-bold shadow-sm active:scale-[0.99] transition-transform"
        >
          閉じる
        </button>
      </div>
    </div>
  );

  return createPortal(shell, viewport);
}
