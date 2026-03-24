import { useState, useEffect } from 'react';
import { Trophy, Users } from 'lucide-react';
import type { ClientTournamentState, TournamentPlayerEliminatedData } from '@plo/shared';
import { formatChips } from '../utils/formatChips';

interface TournamentHUDProps {
  tournamentState: ClientTournamentState;
  isFinalTable: boolean;
  lastEliminated: TournamentPlayerEliminatedData | null;
}

function useCountdown(targetMs: number): string {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, targetMs - Date.now());
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${String(seconds).padStart(2, '0')}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetMs]);

  return remaining;
}

export function TournamentHUD({ tournamentState: ts, isFinalTable, lastEliminated }: TournamentHUDProps) {
  const countdown = useCountdown(ts.nextLevelAt);
  const { currentBlindLevel: bl } = ts;

  return (
    <>
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-sm rounded-b-[2.5cqw] px-[3cqw] py-[1.5cqw] flex items-center gap-[3cqw] text-[2.8cqw] whitespace-nowrap pointer-events-auto">
          <div className="flex items-center gap-[1cqw]">
            <span className="text-yellow-400 font-bold">Lv.{bl.level}</span>
            <span className="text-gray-300">{bl.smallBlind}/{bl.bigBlind}</span>
          </div>

          {ts.nextBlindLevel && (
            <div className="text-gray-400">
              次 <span className="text-white font-medium">{countdown}</span>
            </div>
          )}

          <div className="flex items-center gap-[1cqw]">
            <Users className="w-[3cqw] h-[3cqw] text-gray-400 shrink-0" />
            <span className="text-white font-medium">{ts.playersRemaining}</span>
            <span className="text-gray-500">/ {ts.totalPlayers}</span>
          </div>

          <div className="flex items-center gap-[1cqw]">
            <Trophy className="w-[3cqw] h-[3cqw] text-yellow-400 shrink-0" />
            <span className="text-yellow-400 font-medium">{formatChips(ts.prizePool)}</span>
          </div>
        </div>

        {isFinalTable && (
          <div className="text-center mt-[1cqw]">
            <span className="bg-purple-600/90 text-white text-[2.5cqw] font-bold px-[2cqw] py-[0.5cqw] rounded-full">
              FINAL TABLE
            </span>
          </div>
        )}
      </div>

      <div className="absolute bottom-[46cqw] left-[2cqw] z-30 pointer-events-none">
        <div className="bg-black/70 rounded-[2cqw] px-[2.5cqw] py-[1.5cqw] text-[2.5cqw] space-y-[0.5cqw]">
          <div className="flex justify-between gap-[3cqw]">
            <span className="text-gray-400">平均</span>
            <span className="text-white font-medium">{formatChips(ts.averageStack)}</span>
          </div>
          <div className="flex justify-between gap-[3cqw]">
            <span className="text-gray-400">最大</span>
            <span className="text-green-400 font-medium">{formatChips(ts.largestStack)}</span>
          </div>
          {ts.myChips !== null && (
            <div className="flex justify-between gap-[3cqw]">
              <span className="text-gray-400">自分</span>
              <span className="text-yellow-400 font-bold">{formatChips(ts.myChips)}</span>
            </div>
          )}
        </div>
      </div>

      {lastEliminated && (
        <div className="absolute top-[14cqw] left-1/2 -translate-x-1/2 z-30 animate-fade-in pointer-events-none">
          <div className="bg-red-900/80 backdrop-blur-sm text-white text-[2.8cqw] px-[3cqw] py-[1.5cqw] rounded-[2cqw] max-w-[92cqw] text-center leading-snug">
            <span className="font-bold">{lastEliminated.odName}</span>
            <span className="text-red-300"> が {lastEliminated.position}位で脱落</span>
            <span className="text-gray-300 ml-[2cqw]">残り{lastEliminated.playersRemaining}人</span>
          </div>
        </div>
      )}
    </>
  );
}
