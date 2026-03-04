import { useState, useEffect } from 'react';
import { Player as PlayerType, GameVariant } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction } from '../hooks/useOnlineGameState';

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

const cardPositionStyle = 'top-[10cqw] left-1/2 -translate-x-1/2';

interface PlayerCardsProps {
  player: PlayerType;
  positionIndex: number;
  showCards: boolean;
  isDealing: boolean;
  dealOrder: number;
  lastAction: LastAction | null;
  isSpectator: boolean;
  variant: GameVariant;
  showdownHandName?: string;
  winHandName?: string;
  isWinner: boolean;
}

export function PlayerCards({
  player,
  positionIndex,
  showCards,
  isDealing,
  dealOrder,
  lastAction,
  isSpectator,
  variant,
  showdownHandName,
  winHandName,
  isWinner,
}: PlayerCardsProps) {
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

  // 自分の位置（positionIndex=0）かつ観戦者でない場合はMyCardsで表示するので非表示
  if (positionIndex === 0 && !isSpectator) return null;
  const showCardsml = variant === 'stud' ? '-ml-[6cqw]' : '-ml-[2cqw]';

  return (
    <>
      {/* Hole Cards */}
    <div className={`absolute flex ${showCards && !player.folded ? 'z-[45]' : 'z-[15]'} ${cardPositionStyle}`}>
        {showCards && !player.folded
            ? player.holeCards.map((card, i) => (
                <div key={i} className={i > 0 ? showCardsml : ''}>
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
                          <Card card={card} variant={variant} />
                        </div>
                        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                          <FaceDownCard />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Card card={card} variant={variant} />
                  )}
                </div>
              ))
            : (player.holeCards || Array(4).fill(null)).map((card, cardIndex) => {
                const dealDelay = (cardIndex * 6 + dealOrder) * 40;
                const isFolding = lastAction?.action === 'fold' && Date.now() - lastAction.timestamp < 500;
                const foldOffset = foldToOffsets[positionIndex];
                return (
                  <div
                    key={cardIndex}
                    className={`${cardIndex > 0 ? '-ml-[6cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''} ${isFolding ? 'animate-fold-card' : ''} ${player.folded && !isFolding ? 'invisible' : ''}`}
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
                    {card?.isUp ? <Card card={card} variant={variant} /> : <FaceDownCard />}
                  </div>
                );
              })
        }
      </div>

      {/* Hand Name (showdown) */}
      {(showdownHandName || winHandName) && !player.folded && (
        <div className={`absolute left-1/2 -translate-x-1/2 z-[46] whitespace-nowrap`} style={{ top: '28cqw' }}>
          <span className={`text-[4.5cqw] font-bold px-[2cqw] py-[0.5cqw] rounded bg-black/70 ${isWinner ? 'text-amber-300' : 'text-gray-300'}`}>
            {showdownHandName || winHandName}
          </span>
        </div>
      )}
    </>
  );
}
