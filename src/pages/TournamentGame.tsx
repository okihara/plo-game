import { useEffect, useState, useCallback } from 'react';
import { GameTable } from '../components/GameTable';
import { TournamentHUD } from '../components/TournamentHUD';
import { EliminationOverlay } from '../components/EliminationOverlay';
import { TournamentResultOverlay } from '../components/TournamentResultOverlay';
import { TableMoveOverlay } from '../components/TableMoveOverlay';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useTournamentState } from '../hooks/useTournamentState';
import { wsService } from '../services/websocket';

interface TournamentGameProps {
  tournamentId: string;
  onBack: () => void;
}

export function TournamentGame({ tournamentId, onBack }: TournamentGameProps) {
  const {
    connect,
    tournamentState,
    elimination,
    completedData,
    isChangingTable,
    isFinalTable,
    lastEliminated,
    clearElimination,
    clearCompleted,
  } = useTournamentState();

  const [blinds, setBlinds] = useState('1/2');

  const {
    gameState,
    mySeat,
    myHoleCards,
    lastActions,
    isDealingCards,
    newCommunityCardsCount,
    actionTimeoutAt,
    actionTimeoutMs,
    showdownHandNames,
    handleAction,
    handleFastFold,
  } = useOnlineGameState(blinds);

  // 接続 → テーブルの game:state を要求
  useEffect(() => {
    connect().then(() => {
      wsService.requestTournamentState(tournamentId);
    });
  }, [connect, tournamentId]);

  // ブラインド同期
  useEffect(() => {
    if (tournamentState?.currentBlindLevel) {
      const { smallBlind, bigBlind } = tournamentState.currentBlindLevel;
      setBlinds(`${smallBlind}/${bigBlind}`);
    }
  }, [tournamentState?.currentBlindLevel]);

  const handleBack = useCallback(() => {
    if (elimination || completedData) {
      clearElimination();
      clearCompleted();
    }
    onBack();
  }, [elimination, completedData, clearElimination, clearCompleted, onBack]);

  // 排除された場合
  if (elimination && !completedData) {
    return (
      <div className="relative h-full w-full min-h-0">
        <EliminationOverlay
          position={elimination.position}
          totalPlayers={elimination.totalPlayers}
          prizeAmount={elimination.prizeAmount}
          onClose={handleBack}
        />
      </div>
    );
  }

  if (completedData) {
    return (
      <div className="relative h-full w-full min-h-0">
        <TournamentResultOverlay
          results={completedData.results}
          totalPlayers={completedData.totalPlayers}
          prizePool={completedData.prizePool}
          onClose={handleBack}
        />
      </div>
    );
  }

  if (isChangingTable) {
    return (
      <div className="relative h-full w-full min-h-0">
        <TableMoveOverlay />
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="flex items-center justify-center h-full w-full min-h-0 bg-gray-950">
        <div className="text-center px-[4cqw]">
          <div className="animate-spin w-[10cqw] h-[10cqw] mx-auto mb-[4cqw] rounded-full border-[1cqw] border-white/30 border-t-white" />
          <p className="text-white/60 text-[3cqw]">テーブルに接続中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-0">
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
        onBack={handleBack}
        blindsLabel={blinds}
      >
        {/* トーナメントHUD（オーバーレイ） */}
        {tournamentState && (
          <TournamentHUD
            tournamentState={tournamentState}
            isFinalTable={isFinalTable}
            lastEliminated={lastEliminated}
          />
        )}
      </GameTable>
    </div>
  );
}
