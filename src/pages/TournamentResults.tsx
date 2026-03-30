import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Trophy } from 'lucide-react';
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

  return (
    <div className="h-full w-full light-bg text-cream-900 flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 flex items-center gap-[2cqw] px-[4cqw] py-[3cqw] border-b border-cream-300">
        <button type="button" onClick={onBack} className="p-[1.5cqw] rounded-[2cqw] hover:bg-cream-200 transition-colors">
          <ChevronLeft className="w-[5cqw] h-[5cqw]" />
        </button>
        <Trophy className="w-[5cqw] h-[5cqw] text-forest shrink-0" />
        <h1 className="text-[4cqw] font-bold truncate">{data.name}</h1>
      </div>

      <div className="shrink-0 px-[4cqw] py-[2cqw] flex items-center justify-between text-[3cqw] text-cream-600 border-b border-cream-200">
        <span>参加者: {data.totalPlayers}人</span>
        <span>賞金プール: {formatChips(data.prizePool)}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <table className="w-full text-[3cqw]">
          <thead className="sticky top-0 bg-cream-100">
            <tr className="text-cream-600">
              <th className="py-[2cqw] px-[3cqw] text-left font-medium w-[12cqw]">#</th>
              <th className="py-[2cqw] px-[3cqw] text-left font-medium">プレイヤー</th>
              <th className="py-[2cqw] px-[3cqw] text-right font-medium">賞金</th>
            </tr>
          </thead>
          <tbody>
            {data.results.map((r) => (
              <tr key={r.odId} className="border-b border-cream-100">
                <td className="py-[2cqw] px-[3cqw] font-bold">{r.position}</td>
                <td className="py-[2cqw] px-[3cqw]">
                  {r.odName}
                  {r.reentries > 0 && <span className="text-cream-500 text-[2.5cqw] ml-[1cqw]">(Reentry:{r.reentries})</span>}
                </td>
                <td className={`py-[2cqw] px-[3cqw] text-right font-medium ${r.prize > 0 ? 'text-forest font-bold' : 'text-cream-400'}`}>
                  {r.prize > 0 ? formatChips(r.prize) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
