import { useEffect } from 'react';
import { useSpectatorGameState } from '../hooks/useSpectatorGameState';
import { GameTable } from '../components/GameTable';
import { ConnectingScreen } from '../components/ConnectingScreen';
import { OnlineConnectionGate } from '../components/OnlineConnectionGate';
import { SpectatorAllHands } from '../components/SpectatorAllHands';

interface WatchGameProps {
  tableId: string;
  inviteCode?: string;
  onBack: () => void;
}

export function WatchGame({ tableId, inviteCode, onBack }: WatchGameProps) {
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
        <>
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
          <SpectatorAllHands gameState={gameState} holeCardsBySeat={holeCardsBySeat} />
        </>
      )}
    </OnlineConnectionGate>
  );
}
