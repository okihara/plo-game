import { useEffect, useState, useCallback } from 'react';
import { GameTable } from '../components/GameTable';
import { TournamentHUD } from '../components/TournamentHUD';
import { TableMoveOverlay } from '../components/TableMoveOverlay';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useTournamentState } from '../hooks/useTournamentState';
import { wsService } from '../services/websocket';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

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
    lastEliminated,
    blindChangeNotice,
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
    isWaitingForPlayers,
  } = useOnlineGameState(blinds);

  // まずAPIでトーナメント状態を確認。終了済みなら結果を表示、進行中ならソケット接続
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tournaments/${tournamentId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'completed') {
          // 終了済み → 結果ページへ遷移
          const resultPath = `/tournament/${tournamentId}/result`;
          window.history.replaceState({}, '', resultPath);
          window.dispatchEvent(new PopStateEvent('popstate'));
          return;
        }
      } catch {
        // APIエラー時はソケット接続にフォールバック
      }
      if (cancelled) return;
      // 進行中 → ソケット接続
      connect().then(() => {
        wsService.requestTournamentState(tournamentId);
      });
    })();
    return () => { cancelled = true; };
  }, [connect, tournamentId]);

  // ブラインド同期: game:state（ハンド開始時）のブラインドを反映
  useEffect(() => {
    if (gameState && gameState.smallBlind > 0) {
      setBlinds(`${gameState.smallBlind}/${gameState.bigBlind}`);
    }
  }, [gameState?.smallBlind, gameState?.bigBlind]);

  const handleBack = useCallback(() => {
    if (elimination || completedData) {
      clearElimination();
      clearCompleted();
    }
    onBack();
  }, [elimination, completedData, clearElimination, clearCompleted, onBack]);

  // 脱落 or 完了 → 結果ページへ遷移
  useEffect(() => {
    if (elimination || completedData) {
      clearElimination();
      clearCompleted();
      const resultPath = `/tournament/${tournamentId}/result`;
      window.history.replaceState({}, '', resultPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [elimination, completedData, tournamentId, clearElimination, clearCompleted]);

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
        isWaitingForPlayers={isWaitingForPlayers}
        onBack={handleBack}
        blindsLabel={blinds}
        notice={blindChangeNotice}
      >
        {/* トーナメントHUD（オーバーレイ） */}
        {tournamentState && (
          <TournamentHUD
            tournamentState={tournamentState}
            lastEliminated={lastEliminated}
          />
        )}
      </GameTable>
    </div>
  );
}
