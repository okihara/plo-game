import { useState, useEffect, useRef } from 'react';
import { Player as PlayerType, Action } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';

interface PlayerProps {
  player: PlayerType;
  positionIndex: number;
  isCurrentPlayer: boolean;
  isWinner: boolean;
  winAmount?: number;
  winHandName?: string;
  showdownHandName?: string;
  lastAction: LastAction | null;
  showCards: boolean;
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
  actionTimeoutAt?: ActionTimeoutAt | null;
  actionTimeoutMs?: number | null;
  onAvatarClick?: () => void;
  isSpectator?: boolean;
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
  3: 'top-[-4%] left-1/2 -translate-x-1/2',
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

const cardPositionStyle = 'top-[12cqw] left-1/2 -translate-x-1/2';

const dealerButtonStyle = 'top-[-3cqw] right-[-3cqw]';

const actionColorStyles: Record<Action, string> = {
  fold: 'text-gray-400 border-gray-400',
  check: 'text-blue-400 border-blue-400',
  call: 'text-green-400 border-green-400',
  bet: 'text-orange-400 border-orange-400',
  raise: 'text-orange-400 border-orange-400',
  allin: 'text-red-400 border-red-400',
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

// フォールド時にカードがテーブル中央へ飛んでいく方向（dealFromOffsetsの逆）
const foldToOffsets: Record<number, { x: string; y: string; rotate: string }> = {
  0: { x: '0', y: '-30cqw', rotate: '-20deg' },
  1: { x: '20cqw', y: '-15cqw', rotate: '15deg' },
  2: { x: '20cqw', y: '15cqw', rotate: '-15deg' },
  3: { x: '0', y: '30cqw', rotate: '20deg' },
  4: { x: '-20cqw', y: '15cqw', rotate: '15deg' },
  5: { x: '-20cqw', y: '-15cqw', rotate: '-15deg' },
};

export function Player({
  player,
  positionIndex,
  isCurrentPlayer,
  isWinner,
  winAmount,
  winHandName,
  showdownHandName,
  lastAction,
  showCards,
  isDealing,
  dealOrder,
  actionTimeoutAt,
  actionTimeoutMs,
  onAvatarClick,
  isSpectator = false,
}: PlayerProps) {
  const { formatChips } = useGameSettings();

  // ショウダウン時のカード公開アニメーション
  const [isRevealing, setIsRevealing] = useState(false);

  useEffect(() => {
    const shouldShowCards = !player.folded && player.holeCards.length > 0;
    if (shouldShowCards) {
      setIsRevealing(true);
      const timer = setTimeout(() => setIsRevealing(false), 1200);
      return () => clearTimeout(timer);
    } else {
      setIsRevealing(false);
    }
  }, [showCards, player.folded, player.holeCards.length]);

  // チップアニメーション用: currentBetが変化したときにアニメーションを再トリガー
  const prevBetRef = useRef(player.currentBet);
  const [chipAnimKey, setChipAnimKey] = useState(0);

  useEffect(() => {
    // currentBetが増加した時のみアニメーションをトリガー（0→正、または増額時）
    if (player.currentBet > prevBetRef.current) {
      setChipAnimKey(k => k + 1);
    }
    prevBetRef.current = player.currentBet;
  }, [player.currentBet]);

  // avatarUrlがあればそれを優先（Twitterプロフィール画像）、なければavatarIdまたはオフラインモードのフォールバック
  const avatarImage = player ? player.avatarUrl : "./images/icons/anonymous.svg"
  const showActionMarker = !!lastAction;

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
    <div className={`absolute flex flex-col items-center ${positionStyles[positionIndex]} ${isWinner ? 'z-[30]' : ''}`}>
      {/* Win Amount Display */}
      {isWinner && winAmount !== undefined && winAmount > 0 && (
        <div className="absolute top-[-12cqw] left-1/2 -translate-x-1/2 z-[40] animate-win-pop whitespace-nowrap">
          <span className="text-[7cqw] font-black bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 bg-clip-text text-transparent drop-shadow-[0_0_4px_rgba(255,200,0,0.6)]">
            WIN +{formatChips(winAmount)}
          </span>
        </div>
      )}

      {/* Avatar with Timer Ring */}
      <div className="relative">
        {/* Ranking Badge Aura */}
        {!player.folded && (() => {
          const hasWeekly = player.rankingBadges?.includes('weekly_rank_1');
          const hasDaily = player.rankingBadges?.includes('daily_rank_1');
          if (!hasWeekly && !hasDaily) return null;
          const gradientClass = hasWeekly
            ? 'from-cyan-400 via-emerald-300 to-cyan-400'
            : 'from-purple-400 via-fuchsia-300 to-purple-400';
          return (
            <>
              <div className={`absolute inset-[-2.5cqw] w-[27cqw] h-[27cqw] rounded-full bg-gradient-to-r ${gradientClass} animate-spin opacity-30`}
                style={{ animationDuration: '6s', filter: 'blur(3px)' }} />
              <div className={`absolute inset-[-1.5cqw] w-[25cqw] h-[25cqw] rounded-full bg-gradient-to-r ${gradientClass} animate-spin opacity-50`}
                style={{ animationDuration: '6s' }} />
              <div className="absolute inset-[-0.5cqw] w-[23cqw] h-[23cqw] rounded-full bg-gray-900" />
            </>
          );
        })()}
        {/* Current Player Glow Ring */}
        {isCurrentPlayer && (
          <div className="absolute inset-0 w-[22cqw] h-[22cqw] rounded-full animate-ping bg-amber-400/40" />
        )}
        {isCurrentPlayer && (
          <div className="absolute inset-[-2cqw] w-[26cqw] h-[26cqw] rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 animate-spin opacity-70" style={{ animationDuration: '3s' }} />
        )}
        {isCurrentPlayer && (
          <div className="absolute inset-[-1cqw] w-[24cqw] h-[24cqw] rounded-full bg-gray-900" />
        )}
        {/* Timer Ring */}
        {timerProgress !== null && (
          <svg
            className="absolute inset-0 w-[25cqw] h-[25cqw] -m-[1.5cqw] rotate-90 -scale-x-100 z-10"
            viewBox="0 0 100 100"
          >
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="rgba(0,0,0,0.5)"
              strokeWidth="10"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke={timerProgress > 0.3 ? '#22c55e' : timerProgress > 0.1 ? '#eab308' : '#ef4444'}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${timerProgress * 276} 276`}
              className="transition-all duration-100"
            />
          </svg>
        )}
        <div
          onClick={onAvatarClick}
          className={`
            w-[22cqw] h-[22cqw] rounded-full
            bg-gradient-to-br from-gray-500 to-gray-700
            border-[0.7cqw] flex items-center justify-center
            text-[8cqw] relative overflow-hidden cursor-pointer z-10
            ${isCurrentPlayer ? 'border-amber-400 shadow-[0_0_8cqw_rgba(251,191,36,0.8)]' : 'border-white/60'}
            ${player.folded ? 'opacity-40 grayscale' : ''}
            ${isWinner ? 'border-yellow-400 shadow-[0_0_10cqw_rgba(255,200,0,0.8),0_0_20cqw_rgba(255,150,0,0.4)] animate-pulse' : ''}
          `}
        >
          {avatarImage ? (
            <img src={avatarImage} alt={player.name} className="w-full h-full object-cover" />
          ) : (
            <span className="text-[4.5cqw] text-gray-400 font-medium">Empty</span>
          )}
        </div>
        {/* Dealer Button */}
        {player.position === 'BTN' && (
          <div className={`absolute w-[11cqw] h-[11cqw] bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-600 border-[0.8cqw] border-yellow-700 rounded-full flex items-center justify-center text-[5.5cqw] font-black text-gray-800 shadow-md z-[25] ${dealerButtonStyle}`}>
            D
          </div>
        )}
        {/* All-In Marker */}
        {player.isAllIn && !player.folded && (
          <div className="absolute top-[-4cqw] left-[-4cqw] bg-red-600 text-white text-[4.5cqw] font-black px-[2cqw] py-[0.5cqw] rounded-full shadow-md z-[25] leading-none whitespace-nowrap">
            ALL IN
          </div>
        )}
        {/* Remaining seconds display */}
        {remainingTime !== null && (
          <div className="absolute -bottom-[2cqw] left-1/2 -translate-x-1/2 w-[12cqw] h-[7.5cqw] bg-black/80 rounded flex items-center justify-center text-[6cqw] font-bold text-white z-[35] leading-none">
            {Math.ceil(remainingTime / 1000)}s
          </div>
        )}
        {/* Last Action Marker (CSS animation handles fade-out) */}
        {showActionMarker && (
          <div key={lastAction.timestamp} className={`absolute left-1/2 -translate-x-1/2 top-[6cqw] -translate-y-1/2 px-[4cqw] py-[2cqw] rounded-xl text-[5.8cqw] font-bold uppercase whitespace-nowrap z-[30] animate-action-pop pointer-events-none bg-black/90 border-[0.7cqw] ${actionColorStyles[lastAction.action]}`}>
            {formatAction(lastAction.action, lastAction.amount, formatChips)}
          </div>
        )}
      </div>

      {/* Player Info */}
      <div className="bg-black/80 px-[1cqw] py-[0.1cqw] rounded-lg -mt-[3.1cqw] text-center min-w-[25cqw] z-[20]">
        <div className="text-[3.5cqw] text-white-400 whitespace-nowrap">{player.name}</div>
        <div className="text-[4cqw] text-emerald-400">{formatChips(player.chips)}</div>
      </div>

      {/* Hole Cards (for other players, or all players in spectator mode) */}
      {(positionIndex !== 0 || isSpectator) && (
        <div className={`absolute flex ${showCards && !player.folded ? 'z-[45]' : 'z-[15]'} ${cardPositionStyle}`}>
          {showCards && !player.folded
            ? player.holeCards.map((card, i) => (
                <div key={i} className={i > 0 ? '-ml-[2cqw]' : ''}>
                  {isRevealing ? (
                    <div className="w-[11cqw] h-[15.4cqw] relative" style={{ perspective: '400px' }}>
                      <div
                        className="w-full h-full animate-reveal-card"
                        style={{
                          transformStyle: 'preserve-3d',
                          animationDelay: `${i * 120}ms`,
                        }}
                      >
                        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                          <Card card={card} />
                        </div>
                        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                          <FaceDownCard />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Card card={card} />
                  )}
                </div>
              ))
            : Array(4).fill(null).map((_, cardIndex) => {
                // 1枚ずつ全員に配る: 1周目(cardIndex=0)はSBから順に、2周目(cardIndex=1)も同様...
                // dealOrder: SBからの順番(0-5)
                // 各カードの配布タイミング = (周回 * 6人 + 配布順) * 間隔
                const dealDelay = (cardIndex * 6 + dealOrder) * 40;
                const isFolding = lastAction?.action === 'fold' && Date.now() - lastAction.timestamp < 500;
                const foldOffset = foldToOffsets[positionIndex];
                return (
                  <div
                    key={cardIndex}
                    className={`${cardIndex > 0 ? '-ml-[7cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''} ${isFolding ? 'animate-fold-card' : ''} ${player.folded && !isFolding ? 'invisible' : ''}`}
                    style={isDealing ? {
                      opacity: 0,
                      animationDelay: `${dealDelay}ms`,
                      '--deal-from-x': dealFromOffsets[positionIndex].x,
                      '--deal-from-y': dealFromOffsets[positionIndex].y,
                    } as React.CSSProperties : isFolding ? {
                      animationDelay: `${cardIndex * 50}ms`,
                      '--fold-to-x': foldOffset.x,
                      '--fold-to-y': foldOffset.y,
                      '--fold-rotate': `${parseInt(foldOffset.rotate) + cardIndex * 10}deg`,
                    } as React.CSSProperties : {}}
                  >
                    <FaceDownCard />
                  </div>
                );
              })}
        </div>
      )}

      {/* Hand Name (showdown) */}
      {(positionIndex !== 0 || isSpectator) && (showdownHandName || winHandName) && !player.folded && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-[46] whitespace-nowrap`} style={{ top: '28cqw' }}>
          <span className={`text-[4.5cqw] font-bold px-[2cqw] py-[0.5cqw] rounded bg-black/70 ${isWinner ? 'text-amber-300' : 'text-gray-300'}`}>
            {showdownHandName || winHandName}
          </span>
        </div>
      )}

      {/* Current Bet */}
      {player.currentBet > 0 && (
        <div
          key={chipAnimKey}
          className={`absolute bg-black/70 text-yellow-400 px-[3cqw] py-[1.2cqw] rounded-full text-[4.8cqw] font-bold whitespace-nowrap animate-chip-bet ${betPositionStyles[positionIndex]}`}
        >
          {formatChips(player.currentBet)}
        </div>
      )}

    </div>
  );
}
