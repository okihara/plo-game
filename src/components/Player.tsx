import { useState, useEffect, useRef } from 'react';
import { Player as PlayerType, Action, GameVariant } from '../logic';

import { LastAction, ActionTimeoutAt } from '../hooks/useOnlineGameState';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { PlayerCards } from './PlayerCards';

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
  variant?: GameVariant;
  labelColor?: string;
  /** DBBP: このプレイヤーが勝ったボードの 0-indexed 配列（[0], [1], [0,1]）。非DBBP では未定義 */
  wonBoards?: number[];
  /** Hi-Lo: このプレイヤーが勝ったサイドの配列（['high'], ['low'], ['high','low']）。非Hi-Lo では未定義 */
  wonHiLoSides?: ('high' | 'low')[];
}

function formatAction(
  action: Action,
  amount: number,
  formatChips: (n: number) => string,
  drawCount?: number,
  displayChipTotal?: number,
): string {
  const chips = displayChipTotal ?? amount;
  switch (action) {
    case 'fold': return 'FOLD';
    case 'check': return 'CHECK';
    case 'call': return `CALL ${formatChips(chips)}`;
    case 'bet': return `BET ${formatChips(chips)}`;
    case 'raise': return `RAISE ${formatChips(chips)}`;
    case 'allin': return `ALL-IN ${formatChips(chips)}`;
    case 'draw': return drawCount === 0 ? 'STAND PAT' : `DRAW ${drawCount ?? ''}`;
    default: return '';
  }
}

const positionStyles: Record<number, string> = {
  0: 'bottom-[-13.16cqw] left-1/2 -translate-x-1/2', // 自分
  1: 'bottom-[25.74cqw] left-[-14.05cqw]', // 左下
  2: 'top-[35.7cqw] left-[-14.05cqw]', // 左上
  3: 'top-[7.8cqw] left-1/2 -translate-x-1/2', // 上
  4: 'top-[35.7cqw] right-[-14.05cqw]', // 右上
  5: 'bottom-[25.74cqw] right-[-14.05cqw]', // 右下
};

const betPositionStyles: Record<number, string> = {
  0: 'top-[-23cqw]',
  1: 'top-[2cqw] right-[-17cqw]',
  2: 'top-[2cqw] right-[-17cqw]',
  3: 'top-[18cqw]',
  4: 'top-[2cqw] left-[-17cqw]',
  5: 'top-[2cqw] left-[-17cqw]',
};

const dealerButtonStyle = 'bottom-[-5cqw] right-[-5cqw]';

const actionColorStyles: Record<Action, string> = {
  fold: 'text-gray-400 border-gray-400',
  check: 'text-blue-400 border-blue-400',
  call: 'text-green-400 border-green-400',
  bet: 'text-orange-400 border-orange-400',
  raise: 'text-orange-400 border-orange-400',
  allin: 'text-red-400 border-red-400',
  draw: 'text-purple-400 border-purple-400',
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
  variant = 'plo',
  labelColor,
  wonBoards,
  wonHiLoSides,
}: PlayerProps) {
  const { formatChips } = useGameSettings();
  const currentVariant = variant;

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
    <div className={`absolute flex flex-col items-center cursor-pointer ${positionStyles[positionIndex]} ${isWinner ? 'z-[40]' : ''}`} onClick={onAvatarClick}>
      {/* Win Amount Display */}
      {isWinner && winAmount !== undefined && winAmount > 0 && (
        <div className="absolute top-[-25cqw] left-1/2 -translate-x-1/2 z-[40] animate-win-pop whitespace-nowrap">
          <span className="text-[7cqw] font-black bg-gradient-to-b from-yellow-200 via-yellow-400 to-amber-600 bg-clip-text text-transparent [filter:drop-shadow(0_0_4px_rgba(255,200,0,0.6))_drop-shadow(0_1px_2px_rgba(0,0,0,0.8))_drop-shadow(0_0_6px_rgba(0,0,0,0.5))]">
            WIN +{formatChips(winAmount)}
          </span>
        </div>
      )}

      {/* Avatar + Player Info (horizontal row) */}
      <div className="relative z-[25] flex flex-row items-center -translate-y-[3cqw]">
        {/* Avatar with Timer Ring */}
        <div className="relative z-[22]">
          {/* Current Player Glow Ring */}
          {isCurrentPlayer && (
            <div className="absolute inset-[-3cqw] w-[22cqw] h-[22cqw] rounded-full animate-ping bg-white/90" />
          )}
          {isCurrentPlayer && (
            <div className="absolute inset-[-2cqw] w-[20cqw] h-[20cqw] rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-400 animate-spin opacity-70" style={{ animationDuration: '3s' }} />
          )}
          {isCurrentPlayer && (
            <div className="absolute inset-[-1cqw] w-[18cqw] h-[18cqw] rounded-full bg-gray-900" />
          )}
          {/* Timer Ring */}
          {timerProgress !== null && (
            <svg
              className="absolute inset-0 w-[19cqw] h-[19cqw] -m-[1.5cqw] rotate-90 -scale-x-100 z-10"
              viewBox="0 0 100 100"
            >
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="rgba(0,0,0,0.5)"
                strokeWidth="0"
              />
              {/* Progress circle */}
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke={timerProgress > 0.3 ? '#22c55e' : timerProgress > 0.1 ? '#eab308' : '#ef4444'}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={`${timerProgress * 276} 276`}
                className="transition-all duration-100"
              />
            </svg>
          )}
          <div
            className={`
              w-[16cqw] h-[16cqw] rounded-full
              bg-gradient-to-br from-gray-500 to-gray-700
              border-[0.5cqw] flex items-center justify-center
              text-[8cqw] relative overflow-hidden z-10
              ${isCurrentPlayer ? 'border-amber-400 shadow-[0_0_8cqw_rgba(251,191,36,0.8)]' : 'border-white/60'}
              ${player.folded ? 'brightness-[0.3] grayscale' : ''}
              ${isWinner ? 'border-yellow-400' : ''}
            `}
          >
            {avatarImage ? (
              <img src={avatarImage} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[3cqw] text-gray-400 font-medium">Empty</span>
            )}
          </div>
          {/* Dealer Button (PLO only - Stud has no positional dealer) */}
          {player.position === 'BTN' && (
            <div className={`absolute w-[12cqw] h-[12cqw] bg-gradient-to-br from-yellow-100 via-yellow-400 to-yellow-600 border-[0.6cqw] border-yellow-700 rounded-full flex items-center justify-center text-[6cqw] font-black text-gray-800 shadow-md z-[25] ${dealerButtonStyle}`}>
              D
            </div>
          )}
          {/* All-In Marker */}
          {player.isAllIn && !player.folded && (
            <div className="absolute top-[-3cqw] left-[-3cqw] bg-red-600 text-white text-[4cqw] font-black px-[1.5cqw] py-[0.5cqw] rounded-full shadow-md z-[25] leading-none whitespace-nowrap">
              ALL IN
            </div>
          )}
          {/* Remaining seconds display */}
          {remainingTime !== null && (
            <div className="absolute left-1/2 -translate-x-1/2 top-[-3cqw] bg-black rounded-lg px-[2cqw] py-[0.5cqw] flex items-center justify-center text-[5cqw] text-white z-[35] leading-none">
              {Math.ceil(remainingTime / 1000)}s
            </div>
          )}
        </div>

        {/* Player Info */}
        <div className={`relative bg-black/80 border border-white/60 -ml-[4cqw] px-[1cqw] pl-[5cqw] rounded-lg text-center h-[13cqw] w-[32cqw] flex flex-col justify-center z-[20] ${player.hasWeeklyChampion ? 'ring-[0.5cqw] ring-yellow-400 shadow-[0_0_2cqw_rgba(250,204,21,0.6)]' : ''} ${player.folded ? 'brightness-[0.3]' : ''} ${isWinner ? 'animate-[win-box-glow_2s_ease-in-out_infinite]' : ''}`}>
          {labelColor && (
            <div
              className="absolute top-[-1cqw] left-[-1cqw] w-[5cqw] h-[5cqw] rounded-full border-[0.6cqw] border-black/80 z-[25]"
              style={{ backgroundColor: labelColor }}
            />
          )}
          <div className="text-[3.5cqw] text-white truncate">{player.name}</div>
          <div className="text-[4cqw] text-emerald-400">{formatChips(player.chips)}</div>
        </div>
      </div>

      {/* Hole Cards */}
      <PlayerCards
        player={player}
        positionIndex={positionIndex}
        showCards={showCards}
        isDealing={isDealing}
        dealOrder={dealOrder}
        lastAction={lastAction}
        variant={currentVariant}
      />

      {/* Hand Name (showdown) */}
      {(showdownHandName || winHandName) && !player.folded && (() => {
        const handName = (showdownHandName || winHandName) as string;

        // DBBP は "B1: X / B2: Y" 形式を 2 段表示し、勝ったボードのみハイライト
        if (currentVariant === 'plo_double_board_bomb' && handName.includes(' / ')) {
          const lines = handName.split(' / ');
          return (
            <div className="absolute left-1/2 -translate-x-1/2 z-[46]" style={{ top: '7cqw' }}>
              <div className="w-[37cqw] flex flex-col rounded bg-black/90 overflow-hidden">
                {lines.map((line, i) => {
                  const won = wonBoards?.includes(i) ?? false;
                  return (
                    <span
                      key={i}
                      className={`text-[3cqw] h-[5cqw] inline-flex items-center justify-center whitespace-nowrap ${won ? 'text-amber-300 font-bold' : 'text-gray-500'}`}
                    >
                      {line}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        }

        // Hi-Lo は常に 2 段表示。ロー不成立時は下段を "Lo なし" と表示
        if (currentVariant === 'plo_hilo' || currentVariant === 'omaha_hilo' || currentVariant === 'stud_hilo') {
          const hasLow = handName.includes(' / ');
          const [hiName, loName] = hasLow ? handName.split(' / ') : [handName, 'Lo なし'];
          const sides: { label: string; won: boolean; available: boolean }[] = [
            { label: hiName, won: wonHiLoSides?.includes('high') ?? false, available: true },
            { label: loName, won: wonHiLoSides?.includes('low') ?? false, available: hasLow },
          ];
          return (
            <div className="absolute left-1/2 -translate-x-1/2 z-[46]" style={{ top: '7cqw' }}>
              <div className="w-[37cqw] flex flex-col rounded bg-black/90 overflow-hidden">
                {sides.map((s, i) => (
                  <span
                    key={i}
                    className={`text-[3cqw] h-[5cqw] inline-flex items-center justify-center whitespace-nowrap ${
                      s.won ? 'text-amber-300 font-bold' : s.available ? 'text-gray-500' : 'text-gray-500 italic'
                    }`}
                  >
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          );
        }

        const fontSize = handName.length >= 10 ? 'text-[2.0cqw]' : 'text-[4cqw]';
        return (
          <div className="absolute left-1/2 -translate-x-1/2 z-[46]" style={{ top: '7cqw' }}>
            <span className={`${fontSize} w-[37cqw] h-[7cqw] inline-flex items-center justify-center rounded bg-black/90 whitespace-nowrap ${isWinner ? 'text-amber-300' : 'text-gray-300'}`}>
              {handName}
            </span>
          </div>
        );
      })()}

      {/* Current Bet */}
      {player.currentBet > 0 && (
        <div
          key={chipAnimKey}
          className={`absolute bg-black/70 text-yellow-400 text-center w-[18cqw] px-[0.1cqw] py-[0cqw] rounded-full text-[4.0cqw] whitespace-nowrap animate-chip-bet ${betPositionStyles[positionIndex]}`}
        >
          {formatChips(player.currentBet)}
        </div>
      )}

      {/* Last Action Marker (CSS animation handles fade-out) */}
      {showActionMarker && !showdownHandName && !winHandName && !showCards && (
        <div key={lastAction.timestamp} className={`absolute left-1/2 top-[-5.5cqw] -translate-x-1/2 -translate-y-1/2 px-[2cqw] py-[1cqw] rounded-xl text-[5.0cqw] whitespace-nowrap z-[40] animate-action-pop pointer-events-none bg-black/90 border-[0.5cqw] shadow-[0_0_4cqw_rgba(0,0,0,1)] ${actionColorStyles[lastAction.action]}`}>
          {formatAction(lastAction.action, lastAction.amount, formatChips, lastAction.drawCount, lastAction.displayChipTotal)}
        </div>
      )}

    </div>
  );
}
