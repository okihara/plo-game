import { useState, useEffect } from 'react';
import { Trophy, Users } from 'lucide-react';
import type { TournamentState, PlayerEliminatedData } from '../hooks/useTournamentState';

interface TournamentHUDProps {
  tournamentState: TournamentState;
  isFinalTable: boolean;
  lastEliminated: PlayerEliminatedData | null;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) return `${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  return String(amount);
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
      {/* Top-center HUD bar */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <div className="bg-black/80 backdrop-blur-sm rounded-b-xl px-4 py-1.5 flex items-center gap-4 text-xs whitespace-nowrap pointer-events-auto">
          {/* Blind Level */}
          <div className="flex items-center gap-1">
            <span className="text-yellow-400 font-bold">Lv.{bl.level}</span>
            <span className="text-gray-300">{bl.smallBlind}/{bl.bigBlind}</span>
          </div>

          {/* Next level countdown */}
          {ts.nextBlindLevel && (
            <div className="text-gray-400">
              次 <span className="text-white font-medium">{countdown}</span>
            </div>
          )}

          {/* Players remaining */}
          <div className="flex items-center gap-1">
            <Users className="w-3 h-3 text-gray-400" />
            <span className="text-white font-medium">{ts.playersRemaining}</span>
            <span className="text-gray-500">/ {ts.totalPlayers}</span>
          </div>

          {/* Prize pool */}
          <div className="flex items-center gap-1">
            <Trophy className="w-3 h-3 text-yellow-400" />
            <span className="text-yellow-400 font-medium">{formatChips(ts.prizePool)}</span>
          </div>
        </div>

        {/* Final Table badge */}
        {isFinalTable && (
          <div className="text-center mt-1">
            <span className="bg-purple-600/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
              FINAL TABLE
            </span>
          </div>
        )}
      </div>

      {/* Stack info (bottom-left) */}
      <div className="absolute bottom-[180px] left-2 z-30 pointer-events-none">
        <div className="bg-black/70 rounded-lg px-2.5 py-1.5 text-[10px] space-y-0.5">
          <div className="flex justify-between gap-3">
            <span className="text-gray-400">平均</span>
            <span className="text-white font-medium">{formatChips(ts.averageStack)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-400">最大</span>
            <span className="text-green-400 font-medium">{formatChips(ts.largestStack)}</span>
          </div>
          {ts.myChips !== null && (
            <div className="flex justify-between gap-3">
              <span className="text-gray-400">自分</span>
              <span className="text-yellow-400 font-bold">{formatChips(ts.myChips)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Eliminated player notification */}
      {lastEliminated && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 animate-fade-in pointer-events-none">
          <div className="bg-red-900/80 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-lg whitespace-nowrap">
            <span className="font-bold">{lastEliminated.odName}</span>
            <span className="text-red-300"> が {lastEliminated.position}位で脱落</span>
            <span className="text-gray-300 ml-2">残り{lastEliminated.playersRemaining}人</span>
          </div>
        </div>
      )}
    </>
  );
}
