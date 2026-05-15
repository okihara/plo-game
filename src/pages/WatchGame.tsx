import { useEffect, useMemo } from 'react';
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
    const total = tournamentTableIds.length;
    const q = { tournament: tournamentId, invite: inviteCode };
    if (idx < 0) {
      return {
        label: `テーブル —/${total}`,
        onPrevious: () => onNavigateWatchTable(tournamentTableIds[total - 1]!, q),
        onNext: () => onNavigateWatchTable(tournamentTableIds[0]!, q),
        canGoPrevious: true,
        canGoNext: true,
      };
    }
    return {
      label: `テーブル ${idx + 1}/${total}`,
      onPrevious: () => {
        if (idx <= 0) return;
        onNavigateWatchTable(tournamentTableIds[idx - 1]!, q);
      },
      onNext: () => {
        if (idx >= total - 1) return;
        onNavigateWatchTable(tournamentTableIds[idx + 1]!, q);
      },
      canGoPrevious: idx > 0,
      canGoNext: idx < total - 1,
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
          <SpectatorAllHands gameState={gameState} holeCardsBySeat={holeCardsBySeat} nav={spectateNav} />
        </div>
      )}
    </OnlineConnectionGate>
  );
}
