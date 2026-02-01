import { useState } from 'react';
import { Player } from '../components/Player';
import { Player as PlayerType, Card as CardType, Action } from '../logic/types';
import { GameSettingsProvider } from '../contexts/GameSettingsContext';

const sampleCards: CardType[] = [
  { suit: 'h', rank: 'A' },
  { suit: 's', rank: 'K' },
  { suit: 'd', rank: 'Q' },
  { suit: 'c', rank: 'J' },
];

const createPlayer = (name: string, overrides: Partial<PlayerType> = {}): PlayerType => ({
  id: 0,
  name,
  position: 'BTN',
  chips: 1000,
  holeCards: [],
  currentBet: 0,
  totalBetThisRound: 0,
  folded: false,
  isAllIn: false,
  hasActed: false,
  avatarId: 1,
  ...overrides,
});

export function PlayerDebug() {
  const [showCards, setShowCards] = useState(false);
  const [isDealing, setIsDealing] = useState(false);
  const [actionTimestamps, setActionTimestamps] = useState<Record<string, number>>({});

  const startDealing = () => {
    setIsDealing(true);
    setTimeout(() => setIsDealing(false), 2000);
  };

  const triggerAction = (demoId: string) => {
    setActionTimestamps(prev => ({ ...prev, [demoId]: Date.now() }));
  };

  return (
    <GameSettingsProvider>
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-4xl font-bold mb-8">Player Component Debug</h1>

          {/* Global Controls */}
          <div className="mb-8 p-6 bg-gray-800 rounded-lg space-y-4">
            <h2 className="text-2xl font-semibold mb-4">Global Controls</h2>
            <div className="flex gap-4 flex-wrap">
              <button
                onClick={() => setShowCards(!showCards)}
                className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 transition"
              >
                {showCards ? 'Hide Cards' : 'Show Cards'}
              </button>
              <button
                onClick={startDealing}
                className="px-4 py-2 bg-green-600 rounded hover:bg-green-700 transition"
              >
                Trigger Dealing Animation (All)
              </button>
            </div>
          </div>

          {/* Player States Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Normal State */}
            <StateDemo
              title="Normal State"
              description="Default player appearance"
            >
              <Player
                player={createPlayer('Normal', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* Current Player */}
            <StateDemo
              title="Current Player"
              description="Yellow glow animation when it's their turn"
            >
              <Player
                player={createPlayer('Current', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={true}
                isWinner={false}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* Winner */}
            <StateDemo
              title="Winner"
              description="Green glow when player wins the hand"
            >
              <Player
                player={createPlayer('Winner', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={true}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* Folded */}
            <StateDemo
              title="Folded"
              description="Greyscale with reduced opacity"
            >
              <Player
                player={createPlayer('Folded', { holeCards: sampleCards, folded: true })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* With Current Bet */}
            <StateDemo
              title="With Current Bet"
              description="Shows bet amount above player"
            >
              <Player
                player={createPlayer('Bettor', { holeCards: sampleCards, currentBet: 250 })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* Dealer Button */}
            <StateDemo
              title="Dealer Button"
              description="Shows dealer button (BTN position)"
            >
              <Player
                player={createPlayer('Dealer', { holeCards: sampleCards, position: 'BTN' })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </StateDemo>

            {/* Action: Fold */}
            <ActionDemo
              title="Action: Fold"
              description="Grey action marker"
              action="fold"
              amount={0}
              demoId="fold"
              actionTimestamp={actionTimestamps['fold']}
              onTrigger={() => triggerAction('fold')}
            >
              <Player
                player={createPlayer('Folder', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['fold'] ? { action: 'fold', amount: 0, timestamp: actionTimestamps['fold'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* Action: Check */}
            <ActionDemo
              title="Action: Check"
              description="Blue action marker"
              action="check"
              amount={0}
              demoId="check"
              actionTimestamp={actionTimestamps['check']}
              onTrigger={() => triggerAction('check')}
            >
              <Player
                player={createPlayer('Checker', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['check'] ? { action: 'check', amount: 0, timestamp: actionTimestamps['check'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* Action: Call */}
            <ActionDemo
              title="Action: Call"
              description="Green action marker with amount"
              action="call"
              amount={100}
              demoId="call"
              actionTimestamp={actionTimestamps['call']}
              onTrigger={() => triggerAction('call')}
            >
              <Player
                player={createPlayer('Caller', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['call'] ? { action: 'call', amount: 100, timestamp: actionTimestamps['call'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* Action: Bet */}
            <ActionDemo
              title="Action: Bet"
              description="Orange action marker with amount"
              action="bet"
              amount={200}
              demoId="bet"
              actionTimestamp={actionTimestamps['bet']}
              onTrigger={() => triggerAction('bet')}
            >
              <Player
                player={createPlayer('Bettor', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['bet'] ? { action: 'bet', amount: 200, timestamp: actionTimestamps['bet'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* Action: Raise */}
            <ActionDemo
              title="Action: Raise"
              description="Orange action marker with amount"
              action="raise"
              amount={300}
              demoId="raise"
              actionTimestamp={actionTimestamps['raise']}
              onTrigger={() => triggerAction('raise')}
            >
              <Player
                player={createPlayer('Raiser', { holeCards: sampleCards })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['raise'] ? { action: 'raise', amount: 300, timestamp: actionTimestamps['raise'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* Action: All-in */}
            <ActionDemo
              title="Action: All-in"
              description="Red action marker"
              action="allin"
              amount={1000}
              demoId="allin"
              actionTimestamp={actionTimestamps['allin']}
              onTrigger={() => triggerAction('allin')}
            >
              <Player
                player={createPlayer('All-in', { holeCards: sampleCards, isAllIn: true })}
                positionIndex={0}
                isCurrentPlayer={false}
                isWinner={false}
                lastAction={actionTimestamps['allin'] ? { action: 'allin', amount: 1000, timestamp: actionTimestamps['allin'] } : null}
                showCards={showCards}
                isDealing={isDealing}
                dealOrder={0}
              />
            </ActionDemo>

            {/* With Timer */}
            <TimerDemo showCards={showCards} isDealing={isDealing} />
          </div>

          {/* Position Layout Demo */}
          <div className="mt-12 p-6 bg-gray-800 rounded-lg">
            <h2 className="text-2xl font-semibold mb-6">Position Layout (6-MAX)</h2>
            <p className="text-gray-400 mb-4">All 6 positions with various states</p>
            <div className="relative w-full aspect-[9/16] max-w-md mx-auto bg-gradient-to-br from-green-800 to-green-600 rounded-3xl overflow-hidden">
              <div className="@container w-full h-full relative">
                {/* All 6 positions */}
                {[0, 1, 2, 3, 4, 5].map((pos) => (
                  <Player
                    key={pos}
                    player={createPlayer(`P${pos}`, {
                      holeCards: sampleCards,
                      position: pos === 3 ? 'BTN' : ['SB', 'BB', 'UTG', 'HJ', 'CO'][pos] as any,
                      currentBet: pos % 2 === 0 ? 50 : 0,
                      avatarId: pos,
                    })}
                    positionIndex={pos}
                    isCurrentPlayer={pos === 1}
                    isWinner={pos === 4}
                    lastAction={pos === 2 ? { action: 'raise', amount: 150, timestamp: Date.now() } : null}
                    showCards={showCards}
                    isDealing={isDealing}
                    dealOrder={pos}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Back button */}
          <div className="mt-8 text-center">
            <a
              href="/"
              className="inline-block px-6 py-3 bg-gray-700 rounded-lg hover:bg-gray-600 transition"
            >
              ← Back to Lobby
            </a>
          </div>
        </div>
      </div>
    </GameSettingsProvider>
  );
}

function StateDemo({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm mb-6">{description}</p>
      <div className="relative w-full aspect-[4/5] bg-gradient-to-br from-green-800 to-green-600 rounded-2xl overflow-visible">
        <div className="@container w-full h-full relative">
          {children}
        </div>
      </div>
    </div>
  );
}

function ActionDemo({
  title,
  description,
  action,
  onTrigger,
  children
}: {
  title: string;
  description: string;
  action: Action;
  amount: number;
  demoId: string;
  actionTimestamp?: number;
  onTrigger: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400 text-sm mb-4">{description}</p>
      <button
        onClick={onTrigger}
        className="w-full mb-4 px-4 py-2 bg-purple-600 rounded hover:bg-purple-700 transition text-sm font-semibold"
      >
        ▶ Trigger {action.toUpperCase()}
      </button>
      <div className="relative w-full aspect-[4/5] bg-gradient-to-br from-green-800 to-green-600 rounded-2xl overflow-visible">
        <div className="@container w-full h-full relative">
          {children}
        </div>
      </div>
    </div>
  );
}

function TimerDemo({ showCards, isDealing }: { showCards: boolean; isDealing: boolean }) {
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [timerStartTime, setTimerStartTime] = useState<number | null>(null);

  const startTimer = () => {
    const now = Date.now();
    setTimerStartTime(now);
    setIsTimerActive(true);
    setTimeout(() => {
      setIsTimerActive(false);
      setTimerStartTime(null);
    }, 15000);
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <h3 className="text-xl font-semibold mb-2">Action Timer</h3>
      <p className="text-gray-400 text-sm mb-4">Progress ring and countdown (15s)</p>
      <button
        onClick={startTimer}
        disabled={isTimerActive}
        className={`w-full mb-4 px-4 py-2 rounded transition text-sm font-semibold ${
          isTimerActive
            ? 'bg-gray-600 cursor-not-allowed'
            : 'bg-purple-600 hover:bg-purple-700'
        }`}
      >
        {isTimerActive ? '⏱ Timer Running...' : '▶ Start 15s Timer'}
      </button>
      <div className="relative w-full aspect-[4/5] bg-gradient-to-br from-green-800 to-green-600 rounded-2xl overflow-visible">
        <div className="@container w-full h-full relative">
          <Player
            player={createPlayer('Timed', { holeCards: sampleCards })}
            positionIndex={0}
            isCurrentPlayer={true}
            isWinner={false}
            lastAction={null}
            showCards={showCards}
            isDealing={isDealing}
            dealOrder={0}
            actionTimeoutAt={isTimerActive && timerStartTime ? timerStartTime + 15000 : null}
            actionTimeoutMs={isTimerActive ? 15000 : null}
          />
        </div>
      </div>
    </div>
  );
}
