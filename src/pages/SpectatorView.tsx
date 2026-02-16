import { useState, useEffect, useRef } from 'react';
import { useSpectatorState } from '../hooks/useSpectatorState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { Player as PlayerType } from '../logic';
import { PokerTable } from '../components';
import { ProfilePopup } from '../components/ProfilePopup';

const MIN_LOADING_TIME_MS = 1000;

interface SpectatorViewProps {
  tableId: string;
  onBack: () => void;
}

export function SpectatorView({ tableId, onBack }: SpectatorViewProps) {
  const {
    isConnecting,
    connectionError,
    gameState,
    lastActions,
    isDealingCards,
    newCommunityCardsCount,
    actionTimeoutAt,
    actionTimeoutMs,
    connect,
    disconnect,
  } = useSpectatorState(tableId);

  const { setBigBlind } = useGameSettings();

  const [minLoadingComplete, setMinLoadingComplete] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerType | null>(null);
  const mountTimeRef = useRef(Date.now());

  useEffect(() => {
    if (gameState) {
      setBigBlind(gameState.bigBlind);
    }
  }, [gameState, setBigBlind]);

  useEffect(() => {
    const elapsed = Date.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_LOADING_TIME_MS - elapsed);
    const timer = setTimeout(() => setMinLoadingComplete(true), remaining);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const showLoadingScreen = isConnecting || !minLoadingComplete;

  if (showLoadingScreen) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">SPECTATOR MODE</h1>
          <p className="text-white/50 text-sm mb-6">Table: {tableId}</p>
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-400 mx-auto mb-4"></div>
          <p className="text-white/70">観戦テーブルに接続中...</p>
          <button
            onClick={onBack}
            className="mt-6 text-white/40 hover:text-white/60 text-sm transition-colors"
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  if (connectionError) {
    return (
      <div className="min-h-screen w-full bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4">
        <div className="text-center bg-white/10 rounded-2xl p-8 max-w-sm">
          <div className="text-red-400 text-5xl mb-4">!</div>
          <h2 className="text-white text-xl font-bold mb-2">接続エラー</h2>
          <p className="text-white/70 mb-6">{connectionError}</p>
          <div className="space-y-3">
            <button
              onClick={() => connect()}
              className="w-full py-3 px-6 bg-gradient-to-r from-red-500 to-orange-500 rounded-xl font-bold text-white hover:from-red-600 hover:to-orange-600 transition-all"
            >
              再接続
            </button>
            <button
              onClick={onBack}
              className="w-full py-3 px-6 bg-white/20 rounded-xl font-bold text-white hover:bg-white/30 transition-all"
            >
              戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!gameState) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-6xl mb-4">👁</div>
          <p className="text-white text-lg mb-2">テーブルの状態を取得中...</p>
          <p className="text-white/50 text-sm">Table: {tableId}</p>
          <button
            onClick={onBack}
            className="mt-8 py-2 px-6 bg-white/20 rounded-xl text-white hover:bg-white/30 transition-all"
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-full h-screen flex items-center justify-center bg-gray-900 relative">
        <div className="@container flex flex-col w-full h-full max-w-[calc(100vh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative bg-gray-900">
          {/* ヘッダー */}
          <div className="absolute top-0 left-0 right-0 z-40 h-[4%] bg-gray-800/90 backdrop-blur-sm px-[2%] shadow-sm flex items-center justify-between">
            <button
              onClick={onBack}
              className="text-gray-400 hover:text-gray-200 transition-colors"
              style={{ fontSize: 'min(1.8vh, 3vw)' }}
            >
              ← 戻る
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-red-400 leading-none" style={{ fontSize: 'min(1.8vh, 3vw)' }}>SPECTATOR</span>
              <span className="text-gray-500" style={{ fontSize: 'min(1.6vh, 2.6vw)' }}>|</span>
              <span className="font-semibold text-gray-300" style={{ fontSize: 'min(1.7vh, 2.8vw)' }}>{gameState.smallBlind}/{gameState.bigBlind}</span>
            </div>
            <div style={{ fontSize: 'min(1.5vh, 2.5vw)' }} className="text-gray-500">
              {tableId.slice(0, 8)}
            </div>
          </div>

          <PokerTable
            state={gameState}
            lastActions={lastActions}
            isDealingCards={isDealingCards}
            newCommunityCardsCount={newCommunityCardsCount}
            humanIndex={0}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
            onPlayerClick={setSelectedPlayer}
            isSpectator
          />

          {/* MyCards + ActionPanel の代わりのスペーサー */}
          <div className="@container h-[24cqw] bg-gradient-to-b from-transparent to-black/30" />
          <div className="bg-gradient-to-b from-gray-800/95 to-gray-900/95 px-[2.7cqw] py-[3cqw] border-t-2 border-gray-600">
            <div className="text-center text-gray-500" style={{ fontSize: 'min(1.5vh, 2.5vw)' }}>
              観戦モード - 全プレイヤーのカードが表示されています
            </div>
          </div>

          {/* Profile Popup */}
          {selectedPlayer && (
            <ProfilePopup
              name={selectedPlayer.name}
              avatarUrl={selectedPlayer.avatarUrl}
              avatarId={selectedPlayer.avatarId}
              userId={selectedPlayer.odId}
              onClose={() => setSelectedPlayer(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
