import { useGameState } from './hooks/useGameState';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  ResultOverlay,
} from './components';

export function App() {
  const {
    gameState,
    lastActions,
    isProcessingCPU,
    isDealingCards,
    newCommunityCardsCount,
    handleAction,
    startNextHand,
  } = useGameState();

  const humanPlayer = gameState.players.find(p => p.isHuman)!;
  const humanPlayerIdx = gameState.players.findIndex(p => p.isHuman);
  const sbPlayerIdx = gameState.players.findIndex(p => p.position === 'SB');
  const humanDealOrder = (humanPlayerIdx - sbPlayerIdx + 6) % 6;

  return (
    <div className="flex flex-col w-full h-full max-w-screen max-h-screen overflow-hidden relative">
      <PokerTable
        state={gameState}
        lastActions={lastActions}
        isProcessingCPU={isProcessingCPU}
        isDealingCards={isDealingCards}
        newCommunityCardsCount={newCommunityCardsCount}
      />

      <MyCards cards={humanPlayer.holeCards} isDealing={isDealingCards} dealOrder={humanDealOrder} />

      <ActionPanel state={gameState} onAction={handleAction} />

      <ResultOverlay state={gameState} onNextHand={startNextHand} />
    </div>
  );
}
