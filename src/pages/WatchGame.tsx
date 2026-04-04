import { useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSpectatorGameState } from '../hooks/useSpectatorGameState';
import { useTournamentSpectateTableIds } from '../hooks/useTournamentSpectateTableIds';
import { GameTable } from '../components/GameTable';
import { ConnectingScreen } from '../components/ConnectingScreen';
import { OnlineConnectionGate } from '../components/OnlineConnectionGate';
import { SpectatorAllHands } from '../components/SpectatorAllHands';

interface WatchGameProps {
  tableId: string;
  inviteCode?: string;
  /** 付与するとトーナメント内の他卓へ前後移動できる（URL: ?tournament=） */
  tournamentId?: string;
  onNavigateWatchTable?: (tableId: string, query?: { tournament?: string; invite?: string }) => void;
  onBack: () => void;
}

export function WatchGame({ tableId, inviteCode, tournamentId, onNavigateWatchTable, onBack }: WatchGameProps) {
  const {
    isConnecting,
    connectionError,
    isDisplaced,
    gameState,
    myHoleCards,
    holeCardsBySeat,
    lastActions,
    newCommunityCardsCount,
    actionTimeoutAt,
    actionTimeoutMs,
    showdownHandNames,
    maintenanceStatus,
    announcementStatus,
    connectAndWatch,
    disconnect,
  } = useSpectatorGameState(tableId, inviteCode);

  useEffect(() => {
    connectAndWatch();
    return () => {
      disconnect();
    };
  }, [connectAndWatch, disconnect]);

  const tournamentTableIds = useTournamentSpectateTableIds(tournamentId);
  const spectateNav = useMemo(() => {
    if (!tournamentId?.trim() || !onNavigateWatchTable || tournamentTableIds.length < 2) {
      return undefined;
    }
    const idx = tournamentTableIds.indexOf(tableId);
    const q = { tournament: tournamentId, invite: inviteCode };
    if (idx < 0) {
      return {
        onPrevious: () =>
          onNavigateWatchTable(tournamentTableIds[tournamentTableIds.length - 1]!, q),
        onNext: () => onNavigateWatchTable(tournamentTableIds[0]!, q),
        canGoPrevious: true,
        canGoNext: true,
      };
    }
    const canGoPrevious = idx > 0;
    const canGoNext = idx < tournamentTableIds.length - 1;
    return {
      onPrevious: () => {
        if (idx <= 0) return;
        onNavigateWatchTable(tournamentTableIds[idx - 1]!, q);
      },
      onNext: () => {
        if (idx >= tournamentTableIds.length - 1) return;
        onNavigateWatchTable(tournamentTableIds[idx + 1]!, q);
      },
      canGoPrevious,
      canGoNext,
    };
  }, [tournamentId, onNavigateWatchTable, tournamentTableIds, tableId, inviteCode]);

  const blindsLabel = gameState ? `${gameState.smallBlind}/${gameState.bigBlind}` : '—';

  if (isConnecting) {
    return <ConnectingScreen blindsLabel="観戦" onCancel={onBack} />;
  }

  return (
    <OnlineConnectionGate
      isDisplaced={isDisplaced}
      displacedVariant="spectate"
      connectionError={connectionError}
      connectionErrorPolicy="without-game-state"
      hasGameState={!!gameState}
      onBack={onBack}
    >
      {!gameState ? (
        <div className="absolute inset-0 z-[200] flex flex-col items-center justify-center bg-black text-white px-[8%]">
          <p className="text-center mb-6 text-white/80" style={{ fontSize: 'min(2vh, 3.5vw)' }}>
            {connectionError ?? 'テーブルに接続しています…'}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10"
            style={{ fontSize: 'min(2vh, 3.5vw)' }}
          >
            戻る
          </button>
        </div>
      ) : (
        <div className="relative h-full w-full min-h-0">
          <GameTable
            gameState={gameState}
            mySeat={null}
            myHoleCards={myHoleCards}
            lastActions={lastActions}
            isDealingCards={false}
            newCommunityCardsCount={newCommunityCardsCount}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
            showdownHandNames={showdownHandNames}
            handleAction={() => {}}
            onBack={onBack}
            blindsLabel={blindsLabel}
            isSpectator
            maintenanceStatus={maintenanceStatus}
            announcementStatus={announcementStatus}
          />
          {spectateNav && (
            <>
              <button
                type="button"
                onClick={spectateNav.onPrevious}
                disabled={!spectateNav.canGoPrevious}
                title="前のテーブル"
                aria-label="前のテーブル"
                className="absolute left-[2%] top-1/2 z-[20] -translate-y-1/2 flex items-center justify-center w-[10cqw] h-[10cqw] text-white/80 hover:text-white transition-colors rounded-full bg-black/35 border border-white/15 disabled:opacity-35 disabled:pointer-events-none"
              >
                <ChevronLeft className="w-[6cqw] h-[6cqw]" />
              </button>
              <button
                type="button"
                onClick={spectateNav.onNext}
                disabled={!spectateNav.canGoNext}
                title="次のテーブル"
                aria-label="次のテーブル"
                className="absolute right-[2%] top-1/2 z-[20] -translate-y-1/2 flex items-center justify-center w-[10cqw] h-[10cqw] text-white/80 hover:text-white transition-colors rounded-full bg-black/35 border border-white/15 disabled:opacity-35 disabled:pointer-events-none"
              >
                <ChevronRight className="w-[6cqw] h-[6cqw]" />
              </button>
            </>
          )}
          <SpectatorAllHands gameState={gameState} holeCardsBySeat={holeCardsBySeat} />
        </div>
      )}
    </OnlineConnectionGate>
  );
}
