import { useEffect, useState } from 'react';
import { Loader2, Trophy } from 'lucide-react';
import { formatChips } from '../utils/formatChips';
import type { TournamentResult } from '@plo/shared';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

interface TournamentDetail {
  tournamentId: string;
  name: string;
  status: string;
  totalPlayers: number;
  prizePool: number;
  results: TournamentResult[];
}

interface TournamentResultsProps {
  tournamentId: string;
  onBack: () => void;
}

const POSITION_COLORS: Record<number, { bg: string; border: string; text: string; glow: string }> = {
  1: { bg: 'bg-gradient-to-b from-yellow-300 via-yellow-400 to-amber-500', border: 'border-yellow-400', text: 'text-yellow-900', glow: 'shadow-[0_0_20px_rgba(251,191,36,0.4)]' },
  2: { bg: 'bg-gradient-to-b from-gray-200 via-gray-300 to-gray-400', border: 'border-gray-300', text: 'text-gray-700', glow: 'shadow-[0_0_16px_rgba(156,163,175,0.35)]' },
  3: { bg: 'bg-gradient-to-b from-amber-500 via-amber-600 to-amber-700', border: 'border-amber-500', text: 'text-amber-900', glow: 'shadow-[0_0_14px_rgba(217,119,6,0.3)]' },
};

function PodiumCard({ result, size }: { result: TournamentResult; size: 'lg' | 'md' | 'sm' }) {
  const pos = result.position;
  const style = POSITION_COLORS[pos];
  const avatarSize = size === 'lg' ? 'w-[22cqw] h-[22cqw]' : 'w-[17cqw] h-[17cqw]';
  const medalSize = size === 'lg' ? 'text-[10cqw]' : 'text-[7cqw]';
  const nameSize = size === 'lg' ? 'text-[4.5cqw]' : 'text-[4cqw]';
  const prizeSize = size === 'lg' ? 'text-[5cqw]' : 'text-[4.2cqw]';
  const medal = pos === 1 ? '🥇' : pos === 2 ? '🥈' : '🥉';

  return (
    <div className="flex flex-col items-center">
      {/* Medal */}
      <span className={`${medalSize} mb-[1cqw]`}>{medal}</span>

      {/* Avatar with ring */}
      <div className={`${avatarSize} rounded-full ${style.bg} p-[0.8cqw] ${style.glow} mb-[1.5cqw]`}>
        <div className="w-full h-full rounded-full bg-cream-200 border-2 border-white overflow-hidden">
          <img
            src={result.avatarUrl || '/images/icons/anonymous.svg'}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Name */}
      <span className={`${nameSize} font-bold text-cream-900 text-center truncate max-w-[30cqw]`}>
        {result.odName}
      </span>

      {/* Prize */}
      {result.prize > 0 && (
        <span className={`${prizeSize} font-bold text-forest mt-[0.5cqw]`}>
          {formatChips(result.prize)}
        </span>
      )}
    </div>
  );
}

export function TournamentResults({ tournamentId, onBack }: TournamentResultsProps) {
  const [data, setData] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData({ ...json, results: json.results ?? [] } as TournamentDetail);
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
        <button type="button" onClick={onBack} className="px-[6cqw] py-[2.5cqw] bg-forest hover:bg-forest-light text-white rounded-[2cqw] font-bold text-[3.5cqw] transition-colors">
          戻る
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full w-full min-h-0 light-bg">
        <Loader2 className="w-[8cqw] h-[8cqw] animate-spin text-cream-400" />
      </div>
    );
  }

  const top3 = data.results.filter(r => r.position <= 3);
  const rest = data.results.filter(r => r.position > 3);
  // Podium order: 2nd, 1st, 3rd
  const podiumOrder = [
    top3.find(r => r.position === 2),
    top3.find(r => r.position === 1),
    top3.find(r => r.position === 3),
  ].filter((r): r is TournamentResult => r != null);

  return (
    <div className="h-full w-full light-bg text-cream-900 flex flex-col min-h-0 overflow-hidden relative">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-300">
        <Trophy className="w-[6cqw] h-[6cqw] text-forest shrink-0" />
        <h1 className="text-[5cqw] font-bold truncate">{data.name}</h1>
      </div>

      {/* Summary bar */}
      <div className="shrink-0 px-[4cqw] py-[2cqw] flex items-center justify-between text-[4cqw] text-cream-600 border-b border-cream-200">
        <span>参加者: {data.totalPlayers}人</span>
        <span>賞金プール: {formatChips(data.prizePool)}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Podium section */}
        {top3.length > 0 && (
          <div className="px-[4cqw] pt-[4cqw] pb-[3cqw]">
            <div className="flex items-end justify-center gap-[6cqw]">
              {podiumOrder.map(r => (
                <div
                  key={r.odId}
                  className={r.position === 1 ? 'mb-[2cqw]' : ''}
                >
                  <PodiumCard
                    result={r}
                    size={r.position === 1 ? 'lg' : 'sm'}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Remaining results */}
        {rest.length > 0 && (
          <div className="px-[4cqw] pb-[4cqw]">
            <div className="border-t border-cream-200 pt-[2cqw]">
              <div className="space-y-[1cqw]">
                {rest.map((r) => (
                  <div
                    key={r.odId}
                    className="flex items-center gap-[2.5cqw] py-[2.5cqw] px-[3cqw] rounded-[2cqw] hover:bg-cream-50"
                  >
                    {/* Rank */}
                    <div className="w-[8cqw] text-center shrink-0">
                      <span className="text-[4.5cqw] font-bold text-cream-500">{r.position}</span>
                    </div>

                    {/* Avatar + Name */}
                    <div className="flex items-center gap-[2.5cqw] flex-1 min-w-0">
                      <div className="w-[10cqw] h-[10cqw] rounded-full bg-cream-200 border border-cream-300 overflow-hidden shrink-0">
                        <img
                          src={r.avatarUrl || '/images/icons/anonymous.svg'}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <span className="text-[4.2cqw] text-cream-800 truncate block">
                          {r.odName}
                        </span>
                        {r.reentries > 0 && (
                          <span className="text-cream-500 text-[3cqw]">Reentry:{r.reentries}</span>
                        )}
                      </div>
                    </div>

                    {/* Prize */}
                    <div className="text-right shrink-0">
                      <span className={`text-[4.5cqw] font-bold ${r.prize > 0 ? 'text-forest' : 'text-cream-400'}`}>
                        {r.prize > 0 ? formatChips(r.prize) : '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Spacer for bottom button */}
        <div className="h-[18cqw]" />
      </div>

      {/* Bottom back button */}
      <div className="absolute bottom-0 left-0 right-0 z-50 px-[4cqw] pb-[max(3cqw,env(safe-area-inset-bottom))] pt-[2cqw] pointer-events-none">
        <button
          type="button"
          onClick={onBack}
          className="w-full py-[3cqw] bg-cream-900 text-white text-[3.5cqw] font-bold rounded-[2.5cqw] active:bg-cream-800 shadow-[0_4px_20px_rgba(0,0,0,0.2)] pointer-events-auto"
        >
          トーナメント一覧に戻る
        </button>
      </div>
    </div>
  );
}
