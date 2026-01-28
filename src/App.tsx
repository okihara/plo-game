import { useState } from 'react';
import { useGameState } from './hooks/useGameState';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  ResultOverlay,
  HandAnalysisOverlay,
} from './components';

export function App() {
  const {
    gameState,
    lastActions,
    isProcessingCPU,
    isDealingCards,
    newCommunityCardsCount,
    isChangingTable,
    handleAction,
    handlePreFold,
    startNextHand,
  } = useGameState();

  const [showAnalysis, setShowAnalysis] = useState(true);

  const humanPlayer = gameState.players.find(p => p.isHuman)!;
  const humanPlayerIdx = gameState.players.findIndex(p => p.isHuman);
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

  // 9:16コンテナ内でのvh相当の単位を使うため、コンテナベースの設計
  return (
    <div className="flex flex-col w-full h-full max-w-[calc(100vh*9/16)] max-h-[calc(100vw*16/9)] aspect-[9/16] overflow-hidden relative">
      {/* ゲーム情報ヘッダー */}
      <div className="absolute top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-sm py-[1%] text-center shadow-sm">
        <span className="text-[2.5%] font-bold text-pink-600 leading-none" style={{ fontSize: 'min(1.2vh, 2vw)' }}>PLO</span>
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
      />

      <MyCards
        cards={humanPlayer.holeCards}
        communityCards={gameState.communityCards}
        isDealing={isDealingCards}
        dealOrder={humanDealOrder}
      />

      <ActionPanel state={gameState} onAction={handleAction} onPreFold={handlePreFold} />

      <ResultOverlay state={gameState} onNextHand={startNextHand} />

      <HandAnalysisOverlay
        holeCards={humanPlayer.holeCards}
        communityCards={gameState.communityCards}
        isVisible={showAnalysis}
        onClose={() => setShowAnalysis(false)}
      />

      {/* テーブル移動中オーバーレイ */}
      {isChangingTable && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="text-white font-bold" style={{ fontSize: 'min(2.5vh, 4.5vw)' }}>
            テーブル移動中...
          </div>
        </div>
      )}
    </div>
  );
}
