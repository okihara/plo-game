import { useState, useEffect, useRef } from 'react';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { Player as PlayerType } from '../logic';
import { ChevronLeft, Settings } from 'lucide-react';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  // ResultOverlay,
  HandAnalysisOverlay,
} from '../components';
import { ProfilePopup } from '../components/ProfilePopup';
import { HandHistoryPanel } from '../components/HandHistoryPanel';

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
    return (
      <div className="h-full w-full bg-gradient-to-br from-green-950 via-emerald-950 to-black flex items-center justify-center p-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Volt Poker Club</h1>
          <div className="flex items-center justify-center gap-3 mb-8">
            <span className="px-3 py-1 bg-cyan-500/20 text-cyan-400 text-sm font-bold rounded">PLO</span>
            <span className="text-white/60">{blindsLabel}</span>
          </div>
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-cyan-400 mx-auto mb-4"></div>
          <p className="text-white/70">テーブルに接続中...</p>
          <button
            onClick={onBack}
            className="mt-6 text-white/40 hover:text-white/60 text-sm transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    );
  }

  // 接続エラー
  if (connectionError) {
    return (
      <div className="h-full w-full bg-gradient-to-br from-green-950 via-emerald-950 to-black flex items-center justify-center p-4">
        <div className="text-center bg-white/10 rounded-2xl p-8 max-w-sm">
          <div className="text-red-400 text-5xl mb-4">!</div>
          <h2 className="text-white text-xl font-bold mb-2">接続エラー</h2>
          <p className="text-white/70 mb-6">{connectionError}</p>
          <div className="space-y-3">
            <button
              onClick={() => connect().then(() => joinMatchmaking())}
              className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-blue-500 rounded-xl font-bold text-white hover:from-cyan-600 hover:to-blue-600 transition-all"
            >
              再接続
            </button>
            <button
              onClick={onBack}
              className="w-full py-3 px-6 bg-white/20 rounded-xl font-bold text-white hover:bg-white/30 transition-all"
            >
              ロビーに戻る
            </button>
          </div>
        </div>
      </div>
    );
  }

  // テーブル待機中
  if (!gameState) {
    return (
      <div className="h-full bg-gradient-to-br from-green-950 via-emerald-950 to-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-lg mb-2">テーブルを検索中...</p>
          <button
            onClick={onBack}
            className="mt-8 py-2 px-6 bg-white/20 rounded-xl text-white hover:bg-white/30 transition-all"
          >
            キャンセル
          </button>
        </div>
      </div>
    );
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
              className="text-gray-400 hover:text-gray-200 transition-colors"
            >
              <ChevronLeft style={{ width: 'min(2.4vh, 4vw)', height: 'min(2.4vh, 4vw)' }} />
            </button>
            <div />
            {/* 設定ボタン */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className="text-gray-400 hover:text-gray-200 transition-colors"
              >
                <Settings style={{ width: 'min(2vh, 3.4vw)', height: 'min(2vh, 3.4vw)' }} />
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
            <div className="absolute inset-0 z-[200] bg-gradient-to-br from-green-950 via-emerald-950 to-black">
              <HandHistoryPanel onClose={() => setShowHandHistory(false)} />
            </div>
          )}
    </>
  );
}
