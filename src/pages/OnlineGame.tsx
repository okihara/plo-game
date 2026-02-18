import { useState, useEffect, useRef } from 'react';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { Player as PlayerType } from '../logic';
import { DoorOpen, Settings, History } from 'lucide-react';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  // ResultOverlay,
  HandAnalysisOverlay,
} from '../components';
import { ProfilePopup } from '../components/ProfilePopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';
import { ConnectingScreen } from '../components/ConnectingScreen';
import { ConnectionErrorScreen } from '../components/ConnectionErrorScreen';
import { SearchingTableScreen } from '../components/SearchingTableScreen';

const MIN_LOADING_TIME_MS = 1000; // 最低1秒は接続中画面を表示

interface OnlineGameProps {
  blinds: string;
  onBack: () => void;
}

export function OnlineGame({ blinds, onBack }: OnlineGameProps) {
  const {
    isConnecting,
    connectionError,
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
    connect,
    disconnect,
    joinMatchmaking,
    handleAction,
  } = useOnlineGameState(blinds);

  const { settings, setUseBBNotation, setBigBlind } = useGameSettings();

  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [minLoadingComplete, setMinLoadingComplete] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerType | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const mountTimeRef = useRef(Date.now());

  // gameStateが変わったらbigBlindを設定
  useEffect(() => {
    if (gameState) {
      setBigBlind(gameState.bigBlind);
    }
  }, [gameState, setBigBlind]);

  // 最低表示時間のタイマー
  useEffect(() => {
    const elapsed = Date.now() - mountTimeRef.current;
    const remaining = Math.max(0, MIN_LOADING_TIME_MS - elapsed);

    const timer = setTimeout(() => {
      setMinLoadingComplete(true);
    }, remaining);

    return () => clearTimeout(timer);
  }, []);

  // 接続と参加
  useEffect(() => {
    connect().then(() => {
      joinMatchmaking();
    });

    return () => {
      disconnect();
    };
  }, [connect, disconnect, joinMatchmaking]);

  // ブラインド表示用
  const blindsLabel = blinds;

  // 接続中（または最低表示時間が経過していない）
  const showLoadingScreen = isConnecting || !minLoadingComplete;

  if (showLoadingScreen) {
    return <ConnectingScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // 接続エラー
  if (connectionError) {
    return (
      <ConnectionErrorScreen
        error={connectionError}
        onRetry={() => connect().then(() => joinMatchmaking())}
        onBack={onBack}
      />
    );
  }

  // テーブル待機中
  if (!gameState) {
    return <SearchingTableScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // ゲーム画面
  const humanPlayer = mySeat !== null ? gameState.players[mySeat] : null;
  const humanPlayerIdx = mySeat ?? 0;
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

  return (
    <>
      {/* ゲーム情報ヘッダー */}
          <div className="absolute top-0 left-0 right-0 z-40 h-[4%] bg-transparent px-[2%] flex items-center justify-between">
            <button
              onClick={onBack}
              className="flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
            >
              <DoorOpen style={{ width: 'min(4vh, 6.6vw)', height: 'min(4vh, 6.6vw)' }} />
            </button>
            <div />
            <div className="flex items-center gap-[1.5vw]">
            {/* ハンド履歴ボタン */}
            <button
              onClick={() => setShowHandHistory(true)}
              className="flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
            >
              <History style={{ width: 'min(3.6vh, 6vw)', height: 'min(3.6vh, 6vw)' }} />
            </button>
            {/* 設定ボタン */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
              >
                <Settings style={{ width: 'min(3.6vh, 6vw)', height: 'min(3.6vh, 6vw)' }} />
              </button>
              {showSettingsMenu && (
                <div className="absolute top-full right-0 mt-1 bg-gray-800 rounded-lg shadow-lg py-2 min-w-[120px] z-50">
                  <button
                    onClick={() => {
                      setShowAnalysis(!showAnalysis);
                      setShowSettingsMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                    style={{ fontSize: 'min(1.2vh, 2vw)' }}
                  >
                    <span>分析表示</span>
                    <span className={showAnalysis ? 'text-emerald-400' : 'text-gray-500'}>
                      {showAnalysis ? '✓' : ''}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setUseBBNotation(!settings.useBBNotation);
                      setShowSettingsMenu(false);
                    }}
                    className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-700 flex items-center justify-between"
                    style={{ fontSize: 'min(1.2vh, 2vw)' }}
                  >
                    <span>BB表記</span>
                    <span className={settings.useBBNotation ? 'text-emerald-400' : 'text-gray-500'}>
                      {settings.useBBNotation ? '✓' : ''}
                    </span>
                  </button>
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    onClick={() => {
                      setShowSettingsMenu(false);
                      setShowHandHistory(true);
                    }}
                    className="w-full px-3 py-2 text-left text-gray-200 hover:bg-gray-700"
                    style={{ fontSize: 'min(1.2vh, 2vw)' }}
                  >
                    ハンド履歴
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>

          <PokerTable
            state={gameState}
            lastActions={lastActions}
            isDealingCards={isDealingCards}
            newCommunityCardsCount={newCommunityCardsCount}
            humanIndex={humanPlayerIdx}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
            onPlayerClick={setSelectedPlayer}
            showdownHandNames={showdownHandNames}
          />

          <MyCards
            cards={myHoleCards}
            communityCards={gameState.communityCards}
            isDealing={isDealingCards}
            dealOrder={humanDealOrder}
            folded={humanPlayer?.folded}
            handName={showdownHandNames.get(humanPlayerIdx)}
          />

          <ActionPanel state={gameState} mySeat={humanPlayerIdx} onAction={handleAction} />

          {/* <ResultOverlay state={gameState} mySeat={humanPlayerIdx} /> */}

          {humanPlayer && (
            <HandAnalysisOverlay
              holeCards={myHoleCards}
              communityCards={gameState.communityCards}
              isVisible={showAnalysis}
              onClose={() => setShowAnalysis(false)}
            />
          )}

          {/* テーブル移動中オーバーレイ */}
          {isChangingTable && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
              <div className="text-white font-bold" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
                テーブル移動中...
              </div>
            </div>
          )}

          {/* 他のプレイヤーを待っている状態のオーバーレイ */}
          {isWaitingForPlayers && !isChangingTable && (
            <div className="absolute inset-0 z-[150] flex items-center justify-center bg-black/60 pointer-events-none">
              <div className="text-center">
                <div className="animate-spin w-12 h-12 border-4 border-white/30 border-t-white rounded-full mx-auto mb-4"></div>
                <p className="text-white font-bold mb-2" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
                  他のプレイヤーを待っています...
                </p>
                <p className="text-white/70" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
                  {seatedPlayerCount}/6 人着席中
                </p>
              </div>
            </div>
          )}

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

          {/* ハンド履歴オーバーレイ */}
          {showHandHistory && (
            <div className="absolute inset-0 z-[200] flex items-center justify-center" onClick={() => setShowHandHistory(false)}>
              <div className="absolute inset-0 bg-black/50" />
              <div
                className="relative w-[92%] h-[80%] bg-white rounded-2xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <HandHistoryPanel onClose={() => setShowHandHistory(false)} />
              </div>
            </div>
          )}
    </>
  );
}
