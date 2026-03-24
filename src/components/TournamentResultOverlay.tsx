import { Trophy } from 'lucide-react';
import type { TournamentResult } from '@plo/shared';
import { formatChips } from '../utils/formatChips';

interface TournamentResultOverlayProps {
  results: TournamentResult[];
  totalPlayers: number;
  prizePool: number;
  onClose: () => void;
}

function getMedal(position: number): string {
  if (position === 1) return '🥇';
  if (position === 2) return '🥈';
  if (position === 3) return '🥉';
  return `${position}`;
}

export function TournamentResultOverlay({ results, totalPlayers, prizePool, onClose }: TournamentResultOverlayProps) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm px-[4cqw]">
      <div className="bg-gray-900 rounded-[3cqw] border border-gray-700 p-[6cqw] w-full max-w-[92cqw]">
        <div className="text-center mb-[5cqw]">
          <Trophy className="w-[10cqw] h-[10cqw] text-yellow-400 mx-auto mb-[2cqw]" />
          <h2 className="text-[4.5cqw] font-bold">トーナメント結果</h2>
          <p className="text-[3cqw] text-gray-400 mt-[1cqw]">
            {totalPlayers}人参加 / 賞金プール {formatChips(prizePool)}
          </p>
        </div>

        <div className="space-y-[1cqw] mb-[6cqw] max-h-[64cqw] overflow-y-auto min-h-0">
          {results.slice(0, 10).map((r) => (
            <div
              key={r.odId}
              className={`flex items-center justify-between px-[3cqw] py-[2cqw] rounded-[2cqw] gap-[2cqw] ${
                r.position <= 3 ? 'bg-gray-800' : ''
              }`}
            >
              <div className="flex items-center gap-[2cqw] min-w-0">
                <span className="w-[6cqw] text-center text-[3cqw] shrink-0">
                  {getMedal(r.position)}
                </span>
                <span className={`font-medium text-[3cqw] truncate ${r.position === 1 ? 'text-yellow-400' : ''}`}>
                  {r.odName}
                </span>
              </div>
              {r.prize > 0 && (
                <span className="text-yellow-400 font-bold text-[3cqw] shrink-0">
                  +{formatChips(r.prize)}
                </span>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-[3cqw] bg-gray-700 hover:bg-gray-600 rounded-[2.5cqw] font-bold text-[3.5cqw] transition-colors"
        >
          ロビーに戻る
        </button>
      </div>
    </div>
  );
}
