import { useEffect, useState } from 'react';
import { EliminationOverlay } from '../components/EliminationOverlay';
import type { HandSummaryForResult } from '../components/EliminationOverlay';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface MyResultData {
  tournamentName: string;
  position: number | null;
  totalPlayers: number;
  prizeAmount: number;
  playerName?: string;
}

interface HandStatsData {
  lastHand: HandSummaryForResult | null;
  bestHand: HandSummaryForResult | null;
  worstHand: HandSummaryForResult | null;
  totalHands: number;
}

interface TournamentMyResultProps {
  tournamentId: string;
  onBack: () => void;
}

export function TournamentMyResult({ tournamentId, onBack }: TournamentMyResultProps) {
  const [result, setResult] = useState<MyResultData | null>(null);
  const [handStats, setHandStats] = useState<HandStatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resultRes, statsRes] = await Promise.all([
          fetch(`${API_BASE}/api/tournaments/${tournamentId}/my-result`, { credentials: 'include' }),
          fetch(`${API_BASE}/api/tournaments/${tournamentId}/my-hand-stats`, { credentials: 'include' }),
        ]);
        if (!resultRes.ok) {
          const data = await resultRes.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${resultRes.status}`);
        }
        const data: MyResultData = await resultRes.json();
        if (!cancelled) setResult(data);

        if (statsRes.ok) {
          const stats: HandStatsData = await statsRes.json();
          if (!cancelled) setHandStats(stats);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '取得に失敗しました');
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-0 light-bg px-[4cqw]">
        <p className="text-cream-700 text-[3.5cqw] mb-[4cqw]">{error}</p>
        <button
          type="button"
          onClick={onBack}
          className="px-[6cqw] py-[2.5cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors"
        >
          戻る
        </button>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full w-full min-h-0 light-bg">
        <Loader2 className="w-[8cqw] h-[8cqw] animate-spin text-cream-700" />
      </div>
    );
  }

  // レイト登録中は順位未確定 → プレイスカードではなく「集計中」表示
  if (result.position === null) {
    return (
      <div className="relative h-full w-full min-h-0 light-bg flex flex-col items-center justify-center px-[6cqw]">
        <div className="bg-white rounded-[2cqw] shadow-[0_4px_24px_rgba(0,0,0,0.12)] w-full max-w-[88cqw] px-[6cqw] py-[10cqw] text-center">
          <div className="text-red-600 font-black text-[6cqw] mb-[2cqw]">Busted</div>
          <div className="text-cream-700 text-[3.2cqw] leading-relaxed">
            順位はレイト登録締切後に確定します
          </div>
          {result.tournamentName && (
            <div className="text-cream-700 text-[3cqw] mt-[4cqw] border-t border-cream-300 pt-[3cqw]">
              {result.tournamentName}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onBack}
          className="w-full max-w-[88cqw] mt-[4cqw] py-[3cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors shadow-[0_4px_20px_rgba(45,90,61,0.3)]"
        >
          トーナメント一覧に戻る
        </button>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-h-0 light-bg">
      <EliminationOverlay
        position={result.position}
        totalPlayers={result.totalPlayers}
        prizeAmount={result.prizeAmount}
        tournamentName={result.tournamentName}
        playerName={result.playerName}
        handStats={handStats ?? undefined}
        closeLabel="トーナメント一覧に戻る"
        onClose={onBack}
      />
    </div>
  );
}
