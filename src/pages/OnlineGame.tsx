import { useState, useEffect } from 'react';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { Player as PlayerType } from '../logic';
import { DoorOpen, Settings, History, Volume2, VolumeOff } from 'lucide-react';
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
import { BustedScreen } from '../components/BustedScreen';
import { wsService } from '../services/websocket';
import { isSoundEnabled, setSoundEnabled } from '../services/actionSound';

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
    maintenanceStatus,
    bustedMessage,
    connect,
    disconnect,
    joinMatchmaking,
    handleAction,
  } = useOnlineGameState(blinds);

  const { settings, setUseBBNotation, setBigBlind } = useGameSettings();

  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerType | null>(null);
  const [showHandHistory, setShowHandHistory] = useState(false);
  const [soundOn, setSoundOn] = useState(isSoundEnabled);

  // gameStateが変わったらbigBlindを設定
  useEffect(() => {
    if (gameState) {
      setBigBlind(gameState.bigBlind);
    }
  }, [gameState, setBigBlind]);

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

  // ブラインド表示用
  const blindsLabel = blinds;

  if (isConnecting) {
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
    // バスト中はバストスクリーンを表示
    if (bustedMessage) {
      return <BustedScreen message={bustedMessage} />;
    }
    return <SearchingTableScreen blindsLabel={blindsLabel} onCancel={onBack} />;
  }

  // ゲーム画面
  const humanPlayer = mySeat !== null ? gameState.players[mySeat] : null;
  const humanPlayerIdx = mySeat ?? 0;
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

  return (
    <>
      {/* メンテナンス通知バナー */}
      {maintenanceStatus?.isActive && (
        <div className="absolute top-[4%] left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="bg-red-600/90 text-white text-center py-[0.5cqw] px-[3cqw] rounded-b-[1.5cqw]"
               style={{ fontSize: 'min(1.4vh, 2.3vw)' }}>
            メンテナンス予定 - 現在のハンド終了後、新しいハンドは開始されません
            {maintenanceStatus.message && ` (${maintenanceStatus.message})`}
          </div>
        </div>
      )}
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
            {/* サウンドトグル */}
            <button
              onClick={() => {
                const next = !soundOn;
                setSoundOn(next);
                setSoundEnabled(next);
              }}
              className="flex items-center justify-center text-gray-400 hover:text-gray-200 transition-colors"
            >
              {soundOn
                ? <Volume2 style={{ width: 'min(3.6vh, 6vw)', height: 'min(3.6vh, 6vw)' }} />
                : <VolumeOff style={{ width: 'min(3.6vh, 6vw)', height: 'min(3.6vh, 6vw)' }} />}
            </button>
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
                  {import.meta.env.DEV && (
                    <>
                      <div className="border-t border-gray-700 my-1" />
                      <button
                        onClick={() => {
                            wsService.debugSetChips(6);
                          setShowSettingsMenu(false);
                        }}
                        className="w-full px-3 py-2 text-left text-red-400 hover:bg-gray-700"
                        style={{ fontSize: 'min(1.2vh, 2vw)' }}
                      >
                        🐛 Chips → 6
                      </button>
                    </>
                  )}
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

          {/* バスト通知オーバーレイ */}
          {bustedMessage && (
            <div className="absolute inset-0 z-[200]">
              <BustedScreen message={bustedMessage} />
            </div>
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
