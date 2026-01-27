import { useState } from 'react';
import { Player } from '../components/Player';
import { Player as PlayerType } from '../logic';

const mockPlayers: PlayerType[] = [
  { id: 0, name: 'You', chips: 1000, holeCards: [], currentBet: 50, folded: false, isHuman: true, position: 'BTN', totalBetThisRound: 50, isAllIn: false, hasActed: true },
  { id: 1, name: 'CPU 1', chips: 800, holeCards: [{ rank: 'A', suit: 'h' }, { rank: 'K', suit: 'h' }, { rank: 'Q', suit: 'd' }, { rank: 'J', suit: 's' }], currentBet: 25, folded: false, isHuman: false, position: 'SB', totalBetThisRound: 25, isAllIn: false, hasActed: true },
  { id: 2, name: 'CPU 2', chips: 1200, holeCards: [{ rank: 'T', suit: 'c' }, { rank: '9', suit: 'c' }, { rank: '8', suit: 'd' }, { rank: '7', suit: 's' }], currentBet: 0, folded: true, isHuman: false, position: 'BB', totalBetThisRound: 50, isAllIn: false, hasActed: true },
  { id: 3, name: 'CPU 3', chips: 600, holeCards: [{ rank: '5', suit: 'h' }, { rank: '5', suit: 'd' }, { rank: '6', suit: 'c' }, { rank: '7', suit: 'h' }], currentBet: 100, folded: false, isHuman: false, position: 'UTG', totalBetThisRound: 100, isAllIn: false, hasActed: true },
  { id: 4, name: 'CPU 4', chips: 1500, holeCards: [{ rank: 'A', suit: 's' }, { rank: 'A', suit: 'c' }, { rank: 'K', suit: 's' }, { rank: 'K', suit: 'c' }], currentBet: 0, folded: false, isHuman: false, position: 'HJ', totalBetThisRound: 0, isAllIn: false, hasActed: false },
  { id: 5, name: 'CPU 5', chips: 400, holeCards: [{ rank: '2', suit: 'h' }, { rank: '3', suit: 'd' }, { rank: '4', suit: 'c' }, { rank: '5', suit: 's' }], currentBet: 200, folded: false, isHuman: false, position: 'CO', totalBetThisRound: 200, isAllIn: false, hasActed: true },
];

export function PlayerTest() {
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(1);
  const [showCards, setShowCards] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col h-full aspect-[9/16] max-h-screen overflow-hidden relative bg-gradient-to-b from-[#1a1a2e] to-[#0f0f23]">
      {/* Controls */}
      <div className="p-[2vh] bg-black/50 z-50">
        <h1 className="text-white text-[2vh] font-bold mb-[1vh]">Player Test</h1>
        <div className="flex flex-wrap gap-[1vh]">
          <button
            onClick={() => setCurrentPlayerIndex((i) => (i + 1) % 6)}
            className="px-[1.5vh] py-[0.8vh] bg-yellow-500 text-black text-[1.3vh] font-bold rounded"
          >
            Current: {currentPlayerIndex}
          </button>
          <button
            onClick={() => setShowCards(!showCards)}
            className="px-[1.5vh] py-[0.8vh] bg-blue-500 text-white text-[1.3vh] font-bold rounded"
          >
            {showCards ? 'Hide Cards' : 'Show Cards'}
          </button>
          <button
            onClick={() => setWinnerIndex(winnerIndex === null ? 1 : null)}
            className="px-[1.5vh] py-[0.8vh] bg-green-500 text-white text-[1.3vh] font-bold rounded"
          >
            {winnerIndex !== null ? 'Clear Winner' : 'Set Winner'}
          </button>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 relative flex items-center justify-center min-h-0">
        <div className="h-[75%] aspect-[0.7] bg-[radial-gradient(ellipse_at_center,#1e5631_0%,#145028_50%,#0d3d1c_100%)] rounded-[45%] border-[0.5vh] border-[#2a1810] shadow-[0_0_0_0.3vh_#4a3020,0_0_2vh_rgba(0,0,0,0.5),inset_0_0_4vh_rgba(0,0,0,0.3)] relative">
          {/* POT */}
          <div className="absolute top-[55%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/70 px-[2vh] py-[1vh] rounded-full text-[1.8vh] font-bold text-yellow-400 z-10">
            POT: 375
          </div>

          {/* Players */}
          {mockPlayers.map((player, index) => (
            <Player
              key={player.id}
              player={player}
              positionIndex={index}
              isCurrentPlayer={currentPlayerIndex === index}
              isWinner={winnerIndex === index}
              lastAction={index === 3 ? { action: 'raise', amount: 100, timestamp: Date.now() } : null}
              showCards={showCards}
              isDealing={false}
              dealOrder={index}
            />
          ))}
        </div>
      </div>

      {/* Position Labels */}
      <div className="p-[1vh] bg-black/50 text-[1.2vh] text-gray-400">
        <div className="flex justify-around">
          <span>0: Bottom (You)</span>
          <span>1: Left-Bottom</span>
          <span>2: Left-Top</span>
        </div>
        <div className="flex justify-around mt-[0.5vh]">
          <span>3: Top</span>
          <span>4: Right-Top</span>
          <span>5: Right-Bottom</span>
        </div>
      </div>
    </div>
  );
}
