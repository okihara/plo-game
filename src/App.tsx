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
    <div className="flex flex-col w-full h-full max-w-screen max-h-screen overflow-hidden relative">
      {/* 分析ボタン */}
      <button
        onClick={() => setShowAnalysis(!showAnalysis)}
        className={`absolute top-2 right-2 z-40 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
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
          <div className="text-white text-xl font-bold">
            テーブル移動中...
          </div>
        </div>
      )}
    </div>
  );
}
