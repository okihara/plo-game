import { useEffect, useState } from 'react';
import { EliminationOverlay } from '../components/EliminationOverlay';
import { Loader2 } from 'lucide-react';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface MyResultData {
  tournamentName: string;
  position: number;
  totalPlayers: number;
  prizeAmount: number;
}

interface TournamentMyResultProps {
  tournamentId: string;
  onBack: () => void;
}

export function TournamentMyResult({ tournamentId, onBack }: TournamentMyResultProps) {
  const [result, setResult] = useState<MyResultData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}/my-result`, {
          credentials: 'include',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data: MyResultData = await res.json();
        if (!cancelled) setResult(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '取得に失敗しました');
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full min-h-0 light-bg px-[4cqw]">
        <p className="text-cream-600 text-[3.5cqw] mb-[4cqw]">{error}</p>
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
        <Loader2 className="w-[8cqw] h-[8cqw] animate-spin text-cream-400" />
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
        closeLabel="トーナメント一覧に戻る"
        onClose={onBack}
      />
    </div>
  );
}
