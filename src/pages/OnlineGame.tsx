import { useState, useEffect } from 'react';
import { useOnlineGameState } from '../hooks/useOnlineGameState';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  ResultOverlay,
  HandAnalysisOverlay,
} from '../components';

interface OnlineGameProps {
  onBack: () => void;
}

export function OnlineGame({ onBack }: OnlineGameProps) {
  const {
    isConnecting,
    isConnected,
    connectionError,
    gameState,
    mySeat,
    myHoleCards,
    lastActions,
    isProcessingCPU,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    isWaitingForPlayers,
    seatedPlayerCount,
    actionTimeoutAt,
    actionTimeoutMs,
    connect,
    disconnect,
    joinFastFold,
    handleAction,
    startNextHand,
  } = useOnlineGameState();

  const [showAnalysis, setShowAnalysis] = useState(true);

  // 接続と参加
  useEffect(() => {
    connect().then(() => {
      joinFastFold();
    });

    return () => {
      disconnect();
    };
  }, [connect, disconnect, joinFastFold]);

  // 接続中
  if (isConnecting) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-white text-lg">サーバーに接続中...</p>
        </div>
      </div>
    );
  }

  // 接続エラー
  if (connectionError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center p-4">
        <div className="text-center bg-white/10 rounded-2xl p-8 max-w-sm">
          <div className="text-red-400 text-5xl mb-4">!</div>
          <h2 className="text-white text-xl font-bold mb-2">接続エラー</h2>
          <p className="text-white/70 mb-6">{connectionError}</p>
          <div className="space-y-3">
            <button
              onClick={() => connect().then(() => joinFastFold())}
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
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-6xl mb-4">🎰</div>
          <p className="text-white text-lg mb-2">テーブルを探しています...</p>
          <p className="text-white/50 text-sm">ファストフォールドモード</p>
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
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="w-full h-screen flex items-center justify-center bg-gray-100 relative">
        {/* 戻るボタン */}
        <button
          onClick={onBack}
          className="absolute top-4 left-4 z-50 px-4 py-2 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors text-sm"
        >
          ← ロビー
        </button>

        {/* 接続ステータス */}
        <div className="absolute top-4 right-4 z-50 flex items-center gap-2 px-3 py-1 bg-black/50 rounded-full">
          <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-white/70 text-xs">
            {isConnected ? 'オンライン' : 'オフライン'}
          </span>
        </div>

        <div className="flex flex-col w-full h-full max-w-[calc(100vh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative">
          {/* ゲーム情報ヘッダー */}
          <div className="absolute top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-sm py-[1%] text-center shadow-sm">
            <span className="text-[2.5%] font-bold text-cyan-600 leading-none" style={{ fontSize: 'min(1.2vh, 2vw)' }}>ONLINE PLO</span>
            <span className="text-gray-400 mx-[0.5%]" style={{ fontSize: 'min(1vh, 1.7vw)' }}>|</span>
            <span className="font-semibold text-gray-600" style={{ fontSize: 'min(1.1vh, 1.8vw)' }}>{gameState.smallBlind}/{gameState.bigBlind}</span>
          </div>

          {/* 分析ボタン */}
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className={`absolute z-40 rounded-full flex items-center justify-center font-bold transition-colors ${
              showAnalysis
                ? 'bg-blue-500 text-white'
                : 'bg-black/50 text-gray-300 hover:bg-black/70'
            }`}
            style={{ top: '2%', right: '2%', width: '7%', height: 'calc(7% * 9 / 16)', fontSize: 'min(2vh, 3.5vw)' }}
          >
            i
          </button>

          <PokerTable
            state={gameState}
            lastActions={lastActions}
            isProcessingCPU={isProcessingCPU}
            isDealingCards={isDealingCards}
            newCommunityCardsCount={newCommunityCardsCount}
            humanIndex={humanPlayerIdx}
            actionTimeoutAt={actionTimeoutAt}
            actionTimeoutMs={actionTimeoutMs}
          />

          {humanPlayer && (
            <MyCards
              cards={myHoleCards}
              communityCards={gameState.communityCards}
              isDealing={isDealingCards}
              dealOrder={humanDealOrder}
            />
          )}

          <ActionPanel state={gameState} onAction={handleAction} />

          <ResultOverlay state={gameState} onNextHand={startNextHand} />

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
            <div className="absolute inset-0 z-45 flex items-center justify-center bg-black/60 pointer-events-none">
              <div className="text-center">
                <div className="animate-pulse text-5xl mb-4">⏳</div>
                <p className="text-white font-bold mb-2" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
                  他のプレイヤーを待っています...
                </p>
                <p className="text-white/70" style={{ fontSize: 'min(1.8vh, 3.2vw)' }}>
                  {seatedPlayerCount}/6 人着席中
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
