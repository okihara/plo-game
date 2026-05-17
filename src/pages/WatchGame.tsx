import { useEffect, useMemo, useRef } from 'react';
import { useSpectatorGameState } from '../hooks/useSpectatorGameState';
import { useTournamentSpectateTableIds } from '../hooks/useTournamentSpectateTableIds';
import { GameTable } from '../components/GameTable';
import { ConnectingScreen } from '../components/ConnectingScreen';
import { OnlineConnectionGate } from '../components/OnlineConnectionGate';
import { SpectatorAllHands } from '../components/SpectatorAllHands';
import { TournamentHUD } from '../components/TournamentHUD';

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
    tournamentState,
    connectAndWatch,
    disconnect,
  } = useSpectatorGameState(tableId, inviteCode);

  useEffect(() => {
    connectAndWatch();
    return () => {
      disconnect();
    };
  }, [connectAndWatch, disconnect]);

  const { tableIds: tournamentTableIds, refresh: refreshTournamentTableIds } =
    useTournamentSpectateTableIds(tournamentId);

  // 観戦中の卓がブレイク/統合された場合のみ、トーナメントの別卓へ自動ジャンプ。
  // 他のエラー（rate-limit, 観戦上限, テーブルが見つからない等）では飛ばさない。
  // FT 統合直後はサーバ側で新 FT 卓の登録に少しラグがあるため、短い待機を入れて refresh する。
  const attemptedTableIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!connectionError) return;
    if (!tournamentId?.trim() || !onNavigateWatchTable) return;
    const shouldAutoJump =
      connectionError.includes('閉じられました') ||
      connectionError.includes('統合されました') ||
      connectionError.includes('テーブルが見つかりません');
    if (!shouldAutoJump) return;
    if (attemptedTableIdsRef.current.has(tableId)) return;
    attemptedTableIdsRef.current.add(tableId);
    const q = { tournament: tournamentId, invite: inviteCode };
    const pickOther = (ids: string[]) =>
      ids.find(id => id !== tableId && !attemptedTableIdsRef.current.has(id));
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      const fresh = await refreshTournamentTableIds();
      if (cancelled) return;
      const target = pickOther(fresh) ?? pickOther(tournamentTableIds);
      if (target) onNavigateWatchTable(target, q);
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [connectionError, tournamentId, tableId, inviteCode, onNavigateWatchTable, tournamentTableIds, refreshTournamentTableIds]);
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
            isTournament={!!tournamentState}
            maintenanceStatus={maintenanceStatus}
            announcementStatus={announcementStatus}
          >
            {tournamentState && (
              <TournamentHUD
                tournamentState={tournamentState}
                myChips={null}
                lastEliminated={null}
              />
            )}
          </GameTable>
          <SpectatorAllHands
            gameState={gameState}
            holeCardsBySeat={holeCardsBySeat}
            nav={spectateNav}
            onRefresh={() => window.location.reload()}
          />
        </div>
      )}
    </OnlineConnectionGate>
  );
}
