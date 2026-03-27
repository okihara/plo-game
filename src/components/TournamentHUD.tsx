import { useState, useEffect, useRef } from 'react';
import type { ClientTournamentState, TournamentPlayerEliminatedData } from '@plo/shared';

interface TournamentHUDProps {
  tournamentState: ClientTournamentState;
  lastEliminated: TournamentPlayerEliminatedData | null;
}

function useCountdown(targetMs: number): string {
  const [remaining, setRemaining] = useState('');
  const targetRef = useRef(targetMs);
  targetRef.current = targetMs;

  useEffect(() => {
    const update = () => {
      const diff = Math.max(0, targetRef.current - Date.now());
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setRemaining(`${minutes}:${String(seconds).padStart(2, '0')}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return remaining;
}

export function TournamentHUD({ tournamentState: ts, lastEliminated }: TournamentHUDProps) {
  const countdown = useCountdown(ts.nextLevelAt);
  const { currentBlindLevel: bl } = ts;

  return (
    <>
      {/* トーナメント情報 — 設定ボタンの下 */}
      <div className="absolute top-[14cqw] right-[-6%] z-30 pointer-events-none">
        <div className="bg-cream-200 rounded-[2cqw] px-[3cqw] py-[1.5cqw] text-[3.1cqw] leading-snug shadow-md w-[30cqw]">
          <div className="text-gray-800">
            {ts.playersRemaining}/{ts.totalPlayers}E
          </div>
          <div className="text-gray-800">
            Lv.{bl.level}{ts.nextBlindLevel ? ` - ${countdown}` : ''}
          </div>
        </div>
      </div>

      {lastEliminated && (
        <div className="absolute top-[14cqw] left-[2cqw] z-30 animate-fade-in pointer-events-none">
          <div className="bg-red-900/80 backdrop-blur-sm text-white text-[2.8cqw] px-[3cqw] py-[1.5cqw] rounded-[2cqw] leading-snug">
            <div><span className="font-bold">{lastEliminated.displayName ?? lastEliminated.odName}</span><span className="text-red-300"> が {lastEliminated.position}位で脱落</span></div>
            <div className="text-gray-300">残り{lastEliminated.playersRemaining}人</div>
          </div>
        </div>
      )}
    </>
  );
}
