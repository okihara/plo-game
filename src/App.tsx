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
    startNextHand,
  } = useGameState();

  const [showAnalysis, setShowAnalysis] = useState(true);

  const humanPlayer = gameState.players.find(p => p.isHuman)!;
  const humanPlayerIdx = gameState.players.findIndex(p => p.isHuman);
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

  return (
    <div className="flex flex-col w-full max-w-[calc(100vh*9/16)] aspect-[9/16] overflow-hidden relative">
      {/* ゲーム情報ヘッダー */}
      <div className="fixed top-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-sm py-[0.2vh] text-center shadow-sm">
        <span className="text-[1.2vh] font-bold text-pink-600">PLO</span>
        <span className="text-[1vh] text-gray-400 mx-[0.3vh]">|</span>
        <span className="text-[1.1vh] font-semibold text-gray-600">{gameState.smallBlind}/{gameState.bigBlind}</span>
      </div>

      {/* 分析ボタン */}
      <button
        onClick={() => setShowAnalysis(!showAnalysis)}
        className={`absolute top-[1vh] right-[1vh] z-40 w-[4vh] h-[4vh] rounded-full flex items-center justify-center text-[2vh] font-bold transition-colors ${
          showAnalysis
            ? 'bg-blue-500 text-white'
            : 'bg-black/50 text-gray-300 hover:bg-black/70'
        }`}
      >
        i
      </button>

      <PokerTable
        state={gameState}
        lastActions={lastActions}
        isProcessingCPU={isProcessingCPU}
        isDealingCards={isDealingCards}
        newCommunityCardsCount={newCommunityCardsCount}
      />

      <MyCards
        cards={humanPlayer.holeCards}
        communityCards={gameState.communityCards}
        isDealing={isDealingCards}
        dealOrder={humanDealOrder}
      />

      <ActionPanel state={gameState} onAction={handleAction} />

      <ResultOverlay state={gameState} onNextHand={startNextHand} />

      <HandAnalysisOverlay
        holeCards={humanPlayer.holeCards}
        communityCards={gameState.communityCards}
        isVisible={showAnalysis}
        onClose={() => setShowAnalysis(false)}
      />

      {/* テーブル移動中オーバーレイ */}
      {isChangingTable && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="text-white text-[2.5vh] font-bold">
            テーブル移動中...
          </div>
        </div>
      )}
    </div>
  );
}
