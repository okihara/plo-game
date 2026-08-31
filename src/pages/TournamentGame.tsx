import { useEffect, useState, useCallback } from 'react';
import { GameTable } from '../components/GameTable';
import { TournamentHUD } from '../components/TournamentHUD';
import { TableMoveOverlay } from '../components/TableMoveOverlay';
import { OnlineConnectionGate } from '../components/OnlineConnectionGate';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useTournamentState } from '../hooks/useTournamentState';
import { wsService } from '../services/websocket';

const API_BASE = import.meta.env.VITE_SERVER_URL || '';

/** 盤面が来ないときにトーナメント状態を再要求する間隔 */
const STATE_RESYNC_INTERVAL_MS = 10000;

interface TournamentGameProps {
  tournamentId: string;
  onBack: () => void;
}

export function TournamentGame({ tournamentId, onBack }: TournamentGameProps) {
  const {
    connect,
    disconnect,
    tournamentState,
    elimination,
    completedData,
    isChangingTable,
    lastEliminated,
    blindChangeNotice,
    clearElimination,
    clearCompleted,
    maintenanceStatus,
    announcementStatus,
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
    connectionError,
    isDisplaced,
    isReconnecting,
    connectionEpoch,
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
    return () => {
      cancelled = true;
      disconnect();
    };
  }, [connect, disconnect, tournamentId]);

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

  // 卓の状態が届かないまま固まるのを防ぐ保険。
  // バスト時の tournament:eliminated を取りこぼす（切断・ソケット差し替え）と、
  // table:left で盤面が消えたまま「テーブルに接続中...」から進めなくなる。
  // 状態を定期的に要求し直せば、脱落済みならサーバーが tournament:eliminated を
  // 返してくれるので結果画面へ抜けられる。
  useEffect(() => {
    if (gameState) return;
    const timer = setInterval(() => {
      wsService.requestTournamentState(tournamentId);
    }, STATE_RESYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [gameState, tournamentId]);

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

  return (
    <OnlineConnectionGate
      isDisplaced={isDisplaced}
      isReconnecting={isReconnecting}
      connectionError={connectionError}
      onBack={handleBack}
    >
      {!gameState ? (
        <div className="flex items-center justify-center h-full w-full min-h-0 bg-gray-950">
          <div className="text-center px-[4cqw]">
            <div className="animate-spin w-[10cqw] h-[10cqw] mx-auto mb-[4cqw] rounded-full border-[1cqw] border-white/30 border-t-white" />
            <p className="text-white/60 text-[3cqw]">テーブルに接続中...</p>
            {/* 接続が長引いても操作不能に見えないよう、必ず抜け道を用意する */}
            <button
              type="button"
              onClick={handleBack}
              className="mt-[6cqw] px-[6cqw] py-[2.5cqw] text-white/50 underline text-[3cqw]"
            >
              ロビーに戻る
            </button>
          </div>
        </div>
      ) : (
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
            connectionEpoch={connectionEpoch}
            handleAction={handleAction}
            handleFastFold={handleFastFold}
            isWaitingForPlayers={isWaitingForPlayers}
            onBack={handleBack}
            blindsLabel={blinds}
            notice={blindChangeNotice}
            maintenanceStatus={maintenanceStatus}
            announcementStatus={announcementStatus}
            isTournament
          >
            {tournamentState && (
              <TournamentHUD
                tournamentState={tournamentState}
                myChips={mySeat != null ? gameState.players[mySeat]?.chips ?? null : null}
                lastEliminated={lastEliminated}
                myOdId={mySeat != null ? gameState.players[mySeat]?.odId ?? null : null}
                tableSize={gameState.players.filter(Boolean).length}
              />
            )}
          </GameTable>
        </div>
      )}
    </OnlineConnectionGate>
  );
}
