import { useEffect } from 'react';
import { useOnlineGameState, PrivateMode } from '../hooks/useOnlineGameState';
import { GameTable } from '../components/GameTable';

import { ConnectingScreen } from '../components/ConnectingScreen';
import { ConnectionErrorScreen } from '../components/ConnectionErrorScreen';
import { SearchingTableScreen } from '../components/SearchingTableScreen';
import { BustedScreen } from '../components/BustedScreen';

interface NormalGameProps {
  blinds: string;
  isFastFold?: boolean;
  privateMode?: PrivateMode;
  variant?: string;
  onBack: () => void;
}

export function NormalGame({ blinds, isFastFold, privateMode, variant, onBack }: NormalGameProps) {
  const {
    isConnecting,
    connectionError,
    isDisplaced,
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
    privateTableInfo,
    connect,
    disconnect,
    joinMatchmaking,
    handleAction,
    handleFastFold,
  } = useOnlineGameState(blinds, isFastFold, privateMode, variant);

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

  // 別タブで接続された
  if (isDisplaced) {
    return (
      <div className="absolute inset-0 z-[200] flex items-center justify-center bg-black/90">
        <div className="text-center px-[8%]">
          <p className="text-white font-bold mb-4" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
            別のタブで接続されました
          </p>
          <p className="text-white/70 mb-6" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
            このタブでの接続は切断されました
          </p>
          <button
            onClick={onBack}
            className="px-6 py-3 rounded-lg border border-white/30 text-white/80 hover:bg-white/10 active:bg-white/20 transition-colors"
            style={{ fontSize: 'min(2vh, 3.5vw)' }}
          >
            ロビーに戻る
          </button>
        </div>
      </div>
    );
  }

  // 接続エラー
  if (connectionError) {
    return (
      <ConnectionErrorScreen
        error={connectionError}
        onBack={onBack}
      />
    );
  }

  // テーブル待機中
  if (!gameState) {
    if (bustedMessage) {
      return <BustedScreen message={bustedMessage} />;
    }
    return <SearchingTableScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  return (
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
      handleAction={handleAction}
      handleFastFold={handleFastFold}
      onBack={onBack}
      blindsLabel={blindsLabel}
      isFastFold={isFastFold}
      maintenanceStatus={maintenanceStatus}
      announcementStatus={announcementStatus}
      bustedMessage={bustedMessage}
      privateTableInfo={privateTableInfo}
      isChangingTable={isChangingTable}
      isWaitingForPlayers={isWaitingForPlayers}
      seatedPlayerCount={seatedPlayerCount}
    />
  );
}
