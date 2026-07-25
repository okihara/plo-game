import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ClientTournamentState, TournamentPlayerEliminatedData } from '@plo/shared';
import { useCountdown } from '../hooks/useCountdown';
import { TournamentClockPanel } from './TournamentClockPanel';

interface TournamentHUDProps {
  tournamentState: ClientTournamentState;
  myChips: number | null;
  lastEliminated: TournamentPlayerEliminatedData | null;
  /** 自分の odId。観戦モードでは null */
  myOdId?: string | null;
  /** 自席テーブルの人数（クロックパネルの M レシオ補正用） */
  tableSize?: number;
}

const HUD_FINAL_LEVEL_CLOCK = '--:--';

export function TournamentHUD({
  tournamentState: ts,
  myChips,
  lastEliminated,
  myOdId = null,
  tableSize,
}: TournamentHUDProps) {
  const [clockOpen, setClockOpen] = useState(false);
  const isFinalBlindLevel = ts.nextBlindLevel == null;
  const countdown = useCountdown(isFinalBlindLevel ? null : ts.nextLevelAt);
  const { currentBlindLevel: bl } = ts;

  return (
    <>
      {clockOpen && (
        <TournamentClockPanel
          tournamentState={ts}
          myChips={myChips}
          myOdId={myOdId}
          tableSize={tableSize}
          onClose={() => setClockOpen(false)}
        />
      )}
      {/* トーナメント情報 — 設定ボタンの下 */}
      <div className="absolute top-[14cqw] right-0 z-30 pointer-events-none">
        <button
          type="button"
          onClick={() => setClockOpen(true)}
          className="pointer-events-auto flex items-center gap-[1cqw] bg-cream-200 rounded-l-[2cqw] rounded-r-none pl-[2.5cqw] pr-[1cqw] py-[1.4cqw] text-[3.1cqw] leading-snug shadow-md border border-gray-700/12 w-[27cqw] select-none touch-manipulation active:scale-[0.98] active:brightness-95 transition-[transform,filter] duration-150 text-left"
        >
          <div className="flex-1 min-w-0 text-gray-800">
            <div>{ts.playersRemaining}/{ts.totalPlayers}E</div>
            <div>
              Lv.{bl.level}{isFinalBlindLevel ? ` - ${HUD_FINAL_LEVEL_CLOCK}` : ` - ${countdown}`}
            </div>
          </div>
          <ChevronRight className="w-[4cqw] h-[4cqw] shrink-0 text-gray-600/90 stroke-[2.5]" aria-hidden />
        </button>
      </div>

      {lastEliminated && (
        <div className="absolute top-[14cqw] left-[2cqw] z-30 animate-fade-in pointer-events-none">
          <div className="bg-red-900/80 backdrop-blur-sm text-white text-[2.8cqw] px-[3cqw] py-[1.5cqw] rounded-[2cqw] leading-snug">
            <div><span className="font-bold">{lastEliminated.name}</span><span className="text-red-300"> が{lastEliminated.position != null ? ` ${lastEliminated.position}位で` : ''}敗退</span></div>
            <div className="text-gray-300">残り{lastEliminated.playersRemaining}人</div>
          </div>
        </div>
      )}
    </>
  );
}
