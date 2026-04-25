import { ChevronLeft } from 'lucide-react';
import { TournamentList } from '../components/TournamentList';

interface TournamentLobbyProps {
  onJoinTournament: (tournamentId: string) => void;
  onViewMyResult: (tournamentId: string) => void;
  onViewResults: (tournamentId: string) => void;
  onWatchFinalTable: (tournamentId: string, tableId: string) => void;
  onBack: () => void;
}

export function TournamentLobby({ onJoinTournament, onViewMyResult, onViewResults, onWatchFinalTable, onBack }: TournamentLobbyProps) {
  return (
    <div className="h-full w-full light-bg text-cream-900 flex flex-col min-h-0 overflow-hidden">
      <div className="shrink-0 flex items-center px-[4cqw] py-[3cqw] border-b border-cream-300">
        <button
          type="button"
          onClick={onBack}
          className="p-[1.5cqw] rounded-[2cqw] hover:bg-cream-200 transition-colors"
        >
          <ChevronLeft className="w-[5cqw] h-[5cqw]" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        <TournamentList
          onJoinTournament={onJoinTournament}
          onViewMyResult={onViewMyResult}
          onViewResults={onViewResults}
          onWatchFinalTable={onWatchFinalTable}
        />
      </div>
    </div>
  );
}
