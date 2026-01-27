import { Player as PlayerType, Action } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction } from '../hooks/useGameState';

interface PlayerProps {
  player: PlayerType;
  positionIndex: number;
  isCurrentPlayer: boolean;
  isWinner: boolean;
  lastAction: LastAction | null;
  showCards: boolean;
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
}

function formatChips(amount: number): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1)}K`;
  }
  return amount.toString();
}

function formatAction(action: Action, amount: number): string {
  switch (action) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return `CALL ${formatChips(amount)}`;
    case 'bet': return `BET ${formatChips(amount)}`;
    case 'raise': return `RAISE ${formatChips(amount)}`;
    case 'allin': return 'ALL-IN';
    default: return '';
  }
}

const positionStyles: Record<number, string> = {
  0: 'bottom-[-12%] left-1/2 -translate-x-1/2',
  1: 'bottom-[10%] left-[-15%]',
  2: 'top-[25%] left-[-15%]',
  3: 'top-[-8%] left-1/2 -translate-x-1/2',
  4: 'top-[25%] right-[-15%]',
  5: 'bottom-[10%] right-[-15%]',
};

const betPositionStyles: Record<number, string> = {
  0: 'top-[-3.5vh]',
  1: 'top-0 right-[-6vh]',
  2: 'top-[2.5vh] right-[-7vh]',
  3: 'bottom-[-3vh]',
  4: 'top-[2.5vh] left-[-7vh]',
  5: 'top-0 left-[-6vh]',
};

const dealerButtonStyles: Record<number, string> = {
  0: 'top-[-5vh] left-[9vh]',
  1: 'top-[-0.5vh] right-[-4vh]',
  2: 'top-[-0.5vh] right-[-4vh]',
  3: 'bottom-[-4vh] right-[7vh]',
  4: 'top-[-0.5vh] left-[-4vh]',
  5: 'top-[-0.5vh] left-[-4vh]',
};

const actionColorStyles: Record<Action, string> = {
  fold: 'bg-gray-600',
  check: 'bg-blue-500',
  call: 'bg-green-500',
  bet: 'bg-orange-500',
  raise: 'bg-orange-500',
  allin: 'bg-red-500',
};

// カードがテーブル中央から各プレイヤー位置へ飛んでくる方向
// positionIndex: 0=下(自分), 1=左下, 2=左上, 3=上, 4=右上, 5=右下
const dealFromOffsets: Record<number, { x: string; y: string }> = {
  0: { x: '0', y: '-14vh' },    // 下 ← 中央から下へ
  1: { x: '10vh', y: '-7vh' },    // 左下 ← 中央から左下へ
  2: { x: '10vh', y: '7vh' },     // 左上 ← 中央から左上へ
  3: { x: '0', y: '14vh' },     // 上 ← 中央から上へ
  4: { x: '-10vh', y: '7vh' },    // 右上 ← 中央から右上へ
  5: { x: '-10vh', y: '-7vh' },   // 右下 ← 中央から右下へ
};

export function Player({
  player,
  positionIndex,
  isCurrentPlayer,
  isWinner,
  lastAction,
  showCards,
  isDealing,
  dealOrder,
}: PlayerProps) {
  const emoji = player.isHuman ? '👤' : '🤖';
  const showActionMarker = lastAction && (Date.now() - lastAction.timestamp < 1000);

  return (
    <div className={`absolute flex flex-col items-center transition-all duration-300 ${positionStyles[positionIndex]}`}>
      {/* Avatar */}
      <div
        className={`
          w-[5.5vh] h-[5.5vh] rounded-full
          bg-gradient-to-br from-gray-500 to-gray-700
          border-[0.3vh] flex items-center justify-center
          text-[2.5vh] relative overflow-hidden
          ${isCurrentPlayer ? 'border-yellow-400 shadow-[0_0_1.5vh_rgba(255,215,0,0.6)] animate-pulse-glow' : 'border-gray-600'}
          ${player.folded ? 'opacity-40 grayscale' : ''}
          ${isWinner ? 'border-green-400 shadow-[0_0_2vh_rgba(0,255,0,0.6)]' : ''}
        `}
      >
        {emoji}
      </div>

      {/* Player Info */}
      <div className="bg-black/80 px-[1vh] py-[0.5vh] rounded-lg -mt-[1.0vh] text-center min-w-[8vh] z-10">
        <div className="text-[1.3vh] text-gray-400 whitespace-nowrap">{player.name}</div>
        <div className="text-[1.5vh] font-bold text-white">{formatChips(player.chips)}</div>
      </div>

      {/* Hole Cards (for CPU players) */}
      {!player.isHuman && player.holeCards.length > 0 && (
        <div className={`flex gap-[0.3vh] mt-[0.5vh] ${player.folded ? 'invisible' : ''}`}>
          {showCards && !player.folded
            ? player.holeCards.map((card, i) => (
                <div key={i} className="w-[2.3vh] h-[3.3vh] scale-[0.65] origin-top-left">
                  <Card card={card} />
                </div>
              ))
            : Array(4).fill(null).map((_, cardIndex) => {
                // 1枚ずつ全員に配る: 1周目(cardIndex=0)はSBから順に、2周目(cardIndex=1)も同様...
                // dealOrder: SBからの順番(0-5)
                // 各カードの配布タイミング = (周回 * 6人 + 配布順) * 間隔
                const dealDelay = (cardIndex * 6 + dealOrder) * 80;
                return (
                  <div
                    key={cardIndex}
                    className={`w-[2.3vh] h-[3.3vh] scale-[0.65] origin-top-left ${isDealing ? 'animate-deal-card' : ''}`}
                    style={isDealing ? {
                      opacity: 0,
                      animationDelay: `${dealDelay}ms`,
                      '--deal-from-x': dealFromOffsets[positionIndex].x,
                      '--deal-from-y': dealFromOffsets[positionIndex].y,
                    } as React.CSSProperties : {}}
                  >
                    <FaceDownCard />
                  </div>
                );
              })}
        </div>
      )}

      {/* Current Bet */}
      {player.currentBet > 0 && (
        <div className={`absolute bg-black/70 text-yellow-400 px-[0.8vh] py-[0.3vh] rounded-lg text-[1.3vh] font-bold whitespace-nowrap ${betPositionStyles[positionIndex]}`}>
          {formatChips(player.currentBet)}
        </div>
      )}

      {/* Last Action Marker */}
      {showActionMarker && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-[-3.5vh] px-[1vh] py-[0.5vh] rounded-xl text-[1.3vh] font-bold uppercase whitespace-nowrap z-[15] animate-action-pop ${actionColorStyles[lastAction.action]}`}>
          {formatAction(lastAction.action, lastAction.amount)}
        </div>
      )}

      {/* Dealer Button */}
      {player.position === 'BTN' && (
        <div className={`absolute w-[3vh] h-[3vh] bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-600 border-[0.2vh] border-yellow-700 rounded-full flex items-center justify-center text-[1.5vh] font-black text-gray-800 shadow-md z-[25] ${dealerButtonStyles[positionIndex]}`}>
          D
        </div>
      )}
    </div>
  );
}
