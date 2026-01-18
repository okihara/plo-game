import { GameState } from '../logic';
import { LastAction } from '../hooks/useGameState';
import { Player } from './Player';
import { CommunityCards } from './CommunityCards';
import { ThinkingIndicator } from './ThinkingIndicator';

interface PokerTableProps {
  state: GameState;
  lastActions: Map<number, LastAction>;
  isProcessingCPU: boolean;
  isDealingCards: boolean;
  newCommunityCardsCount: number;
}

function formatChips(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

export function PokerTable({
  state,
  lastActions,
  isProcessingCPU,
  isDealingCards,
  newCommunityCardsCount,
}: PokerTableProps) {
  const isShowdown = state.currentStreet === 'showdown' || state.isHandComplete;
  const currentPlayer = state.players[state.currentPlayerIndex];
  const isCPUTurn = currentPlayer && !currentPlayer.isHuman && !state.isHandComplete;

  // Human player is always index 0
  const humanIndex = 0;
  const orderedPlayers = [];
  for (let i = 0; i < 6; i++) {
    const idx = (humanIndex + i) % 6;
    orderedPlayers.push({ player: state.players[idx], playerIdx: idx, posIndex: i });
  }

  return (
    <div className="flex-1 relative flex items-center justify-center p-2.5 min-h-0">
      <ThinkingIndicator playerName={currentPlayer?.name || ''} visible={isCPUTurn && isProcessingCPU} />

      <div className="w-[85%] max-w-[320px] aspect-[0.7] bg-[radial-gradient(ellipse_at_center,#1e5631_0%,#145028_50%,#0d3d1c_100%)] rounded-[45%] border-8 border-[#2a1810] shadow-[0_0_0_4px_#4a3020,0_0_30px_rgba(0,0,0,0.5),inset_0_0_60px_rgba(0,0,0,0.3)] relative">
        {/* Pot Display */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 px-5 py-2 rounded-full text-sm font-bold text-yellow-400 drop-shadow-[0_0_10px_rgba(255,215,0,0.5)] z-10">
          POT: {formatChips(state.pot)}
        </div>

        {/* Community Cards */}
        <CommunityCards cards={state.communityCards} newCardsCount={newCommunityCardsCount} />

        {/* Players */}
        {orderedPlayers.map(({ player, playerIdx, posIndex }) => (
          <Player
            key={player.id}
            player={player}
            positionIndex={posIndex}
            isCurrentPlayer={state.currentPlayerIndex === playerIdx && !state.isHandComplete}
            isWinner={state.winners.some(w => w.playerId === player.id)}
            lastAction={lastActions.get(player.id) || null}
            showCards={isShowdown}
            isDealing={isDealingCards}
          />
        ))}
      </div>
    </div>
  );
}
