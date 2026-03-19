import { Trophy } from 'lucide-react';
import type { TournamentResult } from '../hooks/useTournamentState';

interface TournamentResultOverlayProps {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
  onClose: () => void;
}

function formatChips(amount: number): string {
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  return String(amount);
}

function getMedal(position: number): string {
  if (position === 1) return '🥇';
  if (position === 2) return '🥈';
  if (position === 3) return '🥉';
  return `${position}`;
}

export function TournamentResultOverlay({ results, totalPlayers, prizePool, onClose }: TournamentResultOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-2xl border border-gray-700 p-6 max-w-sm w-full mx-4">
        {/* Header */}
        <div className="text-center mb-5">
          <Trophy className="w-10 h-10 text-yellow-400 mx-auto mb-2" />
          <h2 className="text-xl font-bold">トーナメント結果</h2>
          <p className="text-sm text-gray-400 mt-1">
            {totalPlayers}人参加 / 賞金プール {formatChips(prizePool)}
          </p>
        </div>

        {/* Results table */}
        <div className="space-y-1 mb-6 max-h-64 overflow-y-auto">
          {results.slice(0, 10).map((r) => (
            <div
              key={r.odId}
              className={`flex items-center justify-between px-3 py-2 rounded-lg ${
                r.position <= 3 ? 'bg-gray-800' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="w-6 text-center text-sm">
                  {getMedal(r.position)}
                </span>
                <span className={`font-medium text-sm ${r.position === 1 ? 'text-yellow-400' : ''}`}>
                  {r.odName}
                </span>
              </div>
              {r.prize > 0 && (
                <span className="text-yellow-400 font-bold text-sm">
                  +{formatChips(r.prize)}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-gray-700 hover:bg-gray-600 rounded-xl font-bold transition-colors"
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
