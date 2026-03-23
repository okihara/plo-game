import { useEffect, useState, useCallback } from 'react';
import { OnlineGame } from './OnlineGame';
import { TournamentHUD } from '../components/TournamentHUD';
import { EliminationOverlay } from '../components/EliminationOverlay';
import { TournamentResultOverlay } from '../components/TournamentResultOverlay';
import { TableMoveOverlay } from '../components/TableMoveOverlay';
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
      // 結果画面表示中はロビーに戻す
      clearElimination();
      clearCompleted();
    }
    onBack();
  }, [elimination, completedData, clearElimination, clearCompleted, onBack]);

  // 排除された場合
  if (elimination && !completedData) {
    return (
      <EliminationOverlay
        position={elimination.position}
        totalPlayers={elimination.totalPlayers}
        prizeAmount={elimination.prizeAmount}
        onClose={handleBack}
      />
    );
  }

  // トーナメント完了
  if (completedData) {
    return (
      <TournamentResultOverlay
        results={completedData.results}
        totalPlayers={completedData.totalPlayers}
        prizePool={completedData.prizePool}
        onClose={handleBack}
      />
    );
  }

  // テーブル移動中
  if (isChangingTable) {
    return <TableMoveOverlay />;
  }

  return (
    <div className="relative w-full h-full">
      {/* メインゲーム画面（OnlineGame をそのまま利用） */}
      <OnlineGame
        blinds={blinds}
        onBack={handleBack}
        skipMatchmaking
      />

      {/* トーナメントHUD（オーバーレイ） */}
      {tournamentState && (
        <TournamentHUD
          tournamentState={tournamentState}
          isFinalTable={isFinalTable}
          lastEliminated={lastEliminated}
        />
      )}
    </div>
  );
}
