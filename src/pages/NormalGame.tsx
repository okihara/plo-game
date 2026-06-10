import { useEffect } from 'react';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { GameTable } from '../components/GameTable';

import { ConnectingScreen } from '../components/ConnectingScreen';
import { OnlineConnectionGate } from '../components/OnlineConnectionGate';
import { SearchingTableScreen } from '../components/SearchingTableScreen';
import { BustedScreen } from '../components/BustedScreen';

interface NormalGameProps {
  blinds: string;
  isFastFold?: boolean;
  variant?: string;
  onBack: () => void;
}

export function NormalGame({ blinds, isFastFold, variant, onBack }: NormalGameProps) {
  const {
    isConnecting,
    connectionError,
    isDisplaced,
    isReconnecting,
    connectionEpoch,
    gameState,
    mySeat,
    myHoleCards,
    lastActions,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    isWaitingForPlayers,
    seatedPlayerCount,
    actionTimeoutAt,
    actionTimeoutMs,
    showdownHandNames,
    maintenanceStatus,
    announcementStatus,
    bustedMessage,
    connect,
    disconnect,
    joinMatchmaking,
    handleAction,
    handleFastFold,
  } = useOnlineGameState(blinds, isFastFold, variant);

  // 接続と参加
  useEffect(() => {
    connect().then(() => {
      joinMatchmaking();
    });

    return () => {
      disconnect();
    };
  }, [connect, disconnect, joinMatchmaking]);

  // バスト時にロビーへ戻す
  useEffect(() => {
    if (bustedMessage) {
      const timer = setTimeout(() => {
        onBack();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [bustedMessage, onBack]);

  const blindsLabel = blinds;

  if (isConnecting) {
    return <ConnectingScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  return (
    <OnlineConnectionGate isDisplaced={isDisplaced} isReconnecting={isReconnecting} connectionError={connectionError} onBack={onBack}>
      {!gameState ? (
        bustedMessage ? (
          <BustedScreen message={bustedMessage} />
        ) : (
          <SearchingTableScreen blindsLabel={blindsLabel} onCancel={onBack} />
        )
      ) : (
        <GameTable
          gameState={gameState}
          mySeat={mySeat}
          myHoleCards={myHoleCards}
          lastActions={lastActions}
          isDealingCards={isDealingCards}
          newCommunityCardsCount={newCommunityCardsCount}
          actionTimeoutAt={actionTimeoutAt}
          actionTimeoutMs={actionTimeoutMs}
          showdownHandNames={showdownHandNames}
          connectionEpoch={connectionEpoch}
          handleAction={handleAction}
          handleFastFold={handleFastFold}
          onBack={onBack}
          blindsLabel={blindsLabel}
          isFastFold={isFastFold}
          maintenanceStatus={maintenanceStatus}
          announcementStatus={announcementStatus}
          bustedMessage={bustedMessage}
          isChangingTable={isChangingTable}
          isWaitingForPlayers={isWaitingForPlayers}
          seatedPlayerCount={seatedPlayerCount}
        />
      )}
    </OnlineConnectionGate>
  );
}
