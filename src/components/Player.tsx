import { useState, useEffect } from 'react';
import { Player as PlayerType, Action } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';

interface PlayerProps {
  player: PlayerType;
  positionIndex: number;
  isCurrentPlayer: boolean;
  isWinner: boolean;
  lastAction: LastAction | null;
  showCards: boolean;
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
  actionTimeoutAt?: ActionTimeoutAt | null;
  actionTimeoutMs?: number | null;
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
  0: 'top-[-5cqw]',
  1: 'top-0 right-[-8.6cqw]',
  2: 'top-[3.6cqw] right-[-10cqw]',
  3: 'bottom-[-4.3cqw]',
  4: 'top-[3.6cqw] left-[-10cqw]',
  5: 'top-0 left-[-8.6cqw]',
};

const dealerButtonStyles: Record<number, string> = {
  0: 'top-[-7cqw] left-[13cqw]',
  1: 'top-[-0.7cqw] right-[-5.7cqw]',
  2: 'top-[-0.7cqw] right-[-5.7cqw]',
  3: 'bottom-[-5.7cqw] right-[10cqw]',
  4: 'top-[-0.7cqw] left-[-5.7cqw]',
  5: 'top-[-0.7cqw] left-[-5.7cqw]',
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
  0: { x: '0', y: '-20cqw' },    // 下 ← 中央から下へ
  1: { x: '14cqw', y: '-10cqw' },    // 左下 ← 中央から左下へ
  2: { x: '14cqw', y: '10cqw' },     // 左上 ← 中央から左上へ
  3: { x: '0', y: '20cqw' },     // 上 ← 中央から上へ
  4: { x: '-14cqw', y: '10cqw' },    // 右上 ← 中央から右上へ
  5: { x: '-14cqw', y: '-10cqw' },   // 右下 ← 中央から右下へ
};

// CPUアバター画像マッピング（オフラインモード用フォールバック）
const cpuAvatars: Record<string, string> = {
  'Miko': '/images/icons/avatar1.png',
  'Kento': '/images/icons/avatar2.png',
  'Luna': '/images/icons/avatar3.png',
  'Hiro': '/images/icons/avatar4.png',
  'Tomoka': '/images/icons/avatar5.png',
};

// avatarIdから画像パスを生成
const getAvatarImage = (avatarId: number): string => `/images/icons/avatar${avatarId}.png`;

export function Player({
  player,
  positionIndex,
  isCurrentPlayer,
  isWinner,
  lastAction,
  showCards,
  isDealing,
  dealOrder,
  actionTimeoutAt,
  actionTimeoutMs,
}: PlayerProps) {
  // positionIndex === 0 が自分の位置
  const isMe = positionIndex === 0;
  // avatarIdがあればそれを使用、なければオフラインモードのフォールバック
  const avatarImage = player.avatarId !== undefined
    ? getAvatarImage(player.avatarId)
    : (isMe ? '/images/icons/avatar0.png' : cpuAvatars[player.name]);
  const showActionMarker = lastAction && (Date.now() - lastAction.timestamp < 1000);

  // タイマー表示用の残り時間
  const [remainingTime, setRemainingTime] = useState<number | null>(null);

  useEffect(() => {
    if (!actionTimeoutAt) {
      setRemainingTime(null);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, actionTimeoutAt - Date.now());
      setRemainingTime(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 100);

    return () => clearInterval(interval);
  }, [actionTimeoutAt]);

  // タイマーの進捗率（0-1）
  const timerProgress = actionTimeoutAt && actionTimeoutMs && remainingTime !== null
    ? remainingTime / actionTimeoutMs
    : null;

  return (
    <div className={`absolute flex flex-col items-center transition-all duration-300 ${positionStyles[positionIndex]}`}>
      {/* Avatar with Timer Ring */}
      <div className="relative">
        {/* Timer Ring */}
        {timerProgress !== null && (
          <svg
            className="absolute inset-0 w-[11.4cqw] h-[11.4cqw] -m-[0.7cqw] -rotate-90"
            viewBox="0 0 100 100"
          >
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="6"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke={timerProgress > 0.3 ? '#22c55e' : timerProgress > 0.1 ? '#eab308' : '#ef4444'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${timerProgress * 289} 289`}
              className="transition-all duration-100"
            />
          </svg>
        )}
        <div
          className={`
            w-[10cqw] h-[10cqw] rounded-full
            bg-gradient-to-br from-gray-500 to-gray-700
            border-[0.4cqw] flex items-center justify-center
            text-[3.6cqw] relative overflow-hidden
            ${isCurrentPlayer ? 'border-yellow-400 shadow-[0_0_2.1cqw_rgba(255,215,0,0.6)] animate-pulse-glow' : 'border-gray-600'}
            ${player.folded ? 'opacity-40 grayscale' : ''}
            ${isWinner ? 'border-green-400 shadow-[0_0_2.9cqw_rgba(0,255,0,0.6)]' : ''}
          `}
        >
          {avatarImage ? (
            <img src={avatarImage} alt={player.name} className="w-full h-full object-cover" />
          ) : (
            isMe ? '👤' : '🤖'
          )}
        </div>
        {/* Remaining seconds display */}
        {remainingTime !== null && (
          <div className="absolute -bottom-[0.7cqw] left-1/2 -translate-x-1/2 bg-black/80 px-[1.1cqw] py-[0.3cqw] rounded text-[1.7cqw] font-bold text-white z-20">
            {Math.ceil(remainingTime / 1000)}s
          </div>
        )}
      </div>

      {/* Player Info */}
      <div className="bg-black/80 px-[1.4cqw] py-[0.7cqw] rounded-lg -mt-[1.4cqw] text-center min-w-[11.4cqw] z-10">
        <div className="text-[1.9cqw] text-gray-400 whitespace-nowrap">{player.name}</div>
        <div className="text-[2.1cqw] font-bold text-white">{formatChips(player.chips)}</div>
      </div>

      {/* Hole Cards (for other players) */}
      {positionIndex !== 0 && (
        <div className={`flex gap-[0.4cqw] mt-[0.7cqw] ${player.folded ? 'invisible' : ''}`}>
          {showCards && !player.folded
            ? player.holeCards.map((card, i) => (
                <div key={i} className="w-[3.3cqw] h-[4.7cqw] scale-[0.65] origin-top-left">
                  <Card card={card} />
                </div>
              ))
            : Array(4).fill(null).map((_, cardIndex) => {
                // 1枚ずつ全員に配る: 1周目(cardIndex=0)はSBから順に、2周目(cardIndex=1)も同様...
                // dealOrder: SBからの順番(0-5)
                // 各カードの配布タイミング = (周回 * 6人 + 配布順) * 間隔
                const dealDelay = (cardIndex * 6 + dealOrder) * 40;
                return (
                  <div
                    key={cardIndex}
                    className={`w-[3.3cqw] h-[4.7cqw] scale-[0.65] origin-top-left ${isDealing ? 'animate-deal-card' : ''}`}
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
        <div className={`absolute bg-black/70 text-yellow-400 px-[1.1cqw] py-[0.4cqw] rounded-lg text-[1.9cqw] font-bold whitespace-nowrap ${betPositionStyles[positionIndex]}`}>
          {formatChips(player.currentBet)}
        </div>
      )}

      {/* Last Action Marker */}
      {showActionMarker && (
        <div className={`absolute left-1/2 -translate-x-1/2 top-[-5cqw] px-[1.4cqw] py-[0.7cqw] rounded-xl text-[1.9cqw] font-bold uppercase whitespace-nowrap z-[15] animate-action-pop ${actionColorStyles[lastAction.action]}`}>
          {formatAction(lastAction.action, lastAction.amount)}
        </div>
      )}

      {/* Dealer Button */}
      {player.position === 'BTN' && (
        <div className={`absolute w-[4.3cqw] h-[4.3cqw] bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-600 border-[0.3cqw] border-yellow-700 rounded-full flex items-center justify-center text-[2.1cqw] font-black text-gray-800 shadow-md z-[25] ${dealerButtonStyles[positionIndex]}`}>
          D
        </div>
      )}
    </div>
  );
}
