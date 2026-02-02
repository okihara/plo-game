import { useState, useEffect } from 'react';
import { Player as PlayerType, Action } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';

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

function formatAction(action: Action, amount: number, formatChips: (n: number) => string): string {
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
  1: 'bottom-[5%] left-[-15%]',
  2: 'top-[18%] left-[-15%]',
  3: 'top-[-8%] left-1/2 -translate-x-1/2',
  4: 'top-[18%] right-[-15%]',
  5: 'bottom-[5%] right-[-15%]',
};

const betPositionStyles: Record<number, string> = {
  0: 'top-[-11cqw]',
  1: 'top-0 right-[-19cqw]',
  2: 'top-[8cqw] right-[-22cqw]',
  3: 'bottom-[-9.5cqw]',
  4: 'top-[8cqw] left-[-22cqw]',
  5: 'top-0 left-[-19cqw]',
};

const dealerButtonStyles: Record<number, string> = {
  0: 'top-[-15cqw] left-[29cqw]',
  1: 'top-[-1.5cqw] right-[-12.5cqw]',
  2: 'top-[-1.5cqw] right-[-12.5cqw]',
  3: 'bottom-[-12.5cqw] right-[22cqw]',
  4: 'top-[-1.5cqw] left-[-12.5cqw]',
  5: 'top-[-1.5cqw] left-[-12.5cqw]',
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
  0: { x: '0', y: '-44cqw' },    // 下 ← 中央から下へ
  1: { x: '31cqw', y: '-22cqw' },    // 左下 ← 中央から左下へ
  2: { x: '31cqw', y: '22cqw' },     // 左上 ← 中央から左上へ
  3: { x: '0', y: '44cqw' },     // 上 ← 中央から上へ
  4: { x: '-31cqw', y: '22cqw' },    // 右上 ← 中央から右上へ
  5: { x: '-31cqw', y: '-22cqw' },   // 右下 ← 中央から右下へ
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
  const { formatChips } = useGameSettings();
  // positionIndex === 0 が自分の位置
  const isMe = positionIndex === 0;
  // avatarUrlがあればそれを優先（Twitterプロフィール画像）、なければavatarIdまたはオフラインモードのフォールバック
  const avatarImage = player.avatarUrl
    ? player.avatarUrl
    : (player.avatarId !== undefined
      ? getAvatarImage(player.avatarId)
      : (isMe ? '/images/icons/avatar0.png' : cpuAvatars[player.name]));
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
            className="absolute inset-0 w-[25cqw] h-[25cqw] -m-[1.5cqw] rotate-90 -scale-x-100"
            viewBox="0 0 100 100"
          >
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="rgba(0,0,0,0.3)"
              strokeWidth="12"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={timerProgress > 0.3 ? '#22c55e' : timerProgress > 0.1 ? '#eab308' : '#ef4444'}
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={`${timerProgress * 276} 276`}
              className="transition-all duration-100"
            />
          </svg>
        )}
        <div
          className={`
            w-[22cqw] h-[22cqw] rounded-full
            bg-gradient-to-br from-gray-500 to-gray-700
            border-[1.4cqw] flex items-center justify-center
            text-[8cqw] relative overflow-hidden
            ${isCurrentPlayer ? 'border-yellow-400 shadow-[0_0_4.6cqw_rgba(255,215,0,0.6)] animate-pulse-glow' : 'border-white'}
            ${player.folded ? 'opacity-40 grayscale' : ''}
            ${isWinner ? 'border-green-400 shadow-[0_0_6.4cqw_rgba(0,255,0,0.6)]' : ''}
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
          <div className="absolute -bottom-[1.5cqw] left-1/2 -translate-x-1/2 bg-black/80 px-[2.4cqw] py-[0.7cqw] rounded text-[3.7cqw] font-bold text-white z-20">
            {Math.ceil(remainingTime / 1000)}s
          </div>
        )}
        {/* Last Action Marker */}
        {showActionMarker && (
          <div className={`absolute left-1/2 -translate-x-1/2 top-[6cqw] -translate-y-1/2 px-[3.1cqw] py-[1.5cqw] rounded-xl text-[4.2cqw] font-bold uppercase whitespace-nowrap z-[30] animate-action-pop ${actionColorStyles[lastAction.action]}`}>
            {formatAction(lastAction.action, lastAction.amount, formatChips)}
          </div>
        )}
      </div>

      {/* Player Info */}
      <div className="bg-black/80 px-[1.5cqw] py-[0.7cqw] rounded-lg -mt-[3.1cqw] text-center min-w-[25cqw] z-10">
        <div className="text-[3.5cqw] text-gray-400 whitespace-nowrap">{player.name}</div>
        <div className="text-[4cqw] font-bold text-white">{formatChips(player.chips)}</div>
      </div>

      {/* Hole Cards (for other players) */}
      {positionIndex !== 0 && (
        <div className={`flex mt-[1.5cqw] ${player.folded ? 'invisible' : ''}`}>
          {showCards && !player.folded
            ? player.holeCards.map((card, i) => (
                <div key={i} className={i > 0 ? '-ml-[7cqw]' : ''}>
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
                    className={`${cardIndex > 0 ? '-ml-[7cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''}`}
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
        <div className={`absolute bg-black/70 text-yellow-400 px-[2.4cqw] py-[0.9cqw] rounded-lg text-[4.2cqw] font-bold whitespace-nowrap ${betPositionStyles[positionIndex]}`}>
          {formatChips(player.currentBet)}
        </div>
      )}

      {/* Dealer Button */}
      {player.position === 'BTN' && (
        <div className={`absolute w-[9.5cqw] h-[9.5cqw] bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-600 border-[0.7cqw] border-yellow-700 rounded-full flex items-center justify-center text-[4.6cqw] font-black text-gray-800 shadow-md z-[25] ${dealerButtonStyles[positionIndex]}`}>
          D
        </div>
      )}
    </div>
  );
}
