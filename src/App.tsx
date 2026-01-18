import { useGameState } from './hooks/useGameState';
import {
  PokerTable,
  MyCards,
  ActionPanel,
  ResultOverlay,
  TableTransition,
} from './components';

export function App() {
  const {
    gameState,
    lastActions,
    isProcessingCPU,
    isTableTransition,
    isDealingCards,
    newCommunityCardsCount,
    handleAction,
    startNextHand,
  } = useGameState();

  const humanPlayer = gameState.players.find(p => p.isHuman)!;

  return (
    <div className="flex flex-col w-full h-full max-w-screen max-h-screen overflow-hidden relative">
      <PokerTable
        state={gameState}
        lastActions={lastActions}
        isProcessingCPU={isProcessingCPU}
        isDealingCards={isDealingCards}
        newCommunityCardsCount={newCommunityCardsCount}
      />

      <MyCards cards={humanPlayer.holeCards} isDealing={isDealingCards} />

      <ActionPanel state={gameState} onAction={handleAction} />

      <ResultOverlay state={gameState} onNextHand={startNextHand} />

      <TableTransition visible={isTableTransition} />
    </div>
  );
}
