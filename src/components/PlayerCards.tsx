import { useState, useLayoutEffect } from 'react';
import { Player as PlayerType, GameVariant, getVariantConfig } from '../logic';
import { Card, FaceDownCard } from './Card';
import { LastAction } from '../hooks/useOnlineGameState';

// カードがテーブル中央から各プレイヤー位置へ飛んでくる方向（席数 → posIndex → ベクトル）
// 6席: 0=下(自分), 1=左下, 2=左上, 3=上, 4=右上, 5=右下
// 9席: 0=下(自分), 1=左下, 2=左中下, 3=左中上, 4=左上, 5=右上, 6=右中上, 7=右中下, 8=右下（左右4人ずつ縦並び）
const dealFromOffsetsBySeatCount: Record<number, Record<number, { x: string; y: string }>> = {
  6: {
    0: { x: '0', y: '-44cqw' },    // 下 ← 中央から下へ
    1: { x: '31cqw', y: '-22cqw' },    // 左下 ← 中央から左下へ
    2: { x: '31cqw', y: '22cqw' },     // 左上 ← 中央から左上へ
    3: { x: '0', y: '44cqw' },     // 上 ← 中央から上へ
    4: { x: '-31cqw', y: '22cqw' },    // 右上 ← 中央から右上へ
    5: { x: '-31cqw', y: '-22cqw' },   // 右下 ← 中央から右下へ
  },
  9: {
    0: { x: '0', y: '-44cqw' },
    1: { x: '31cqw', y: '-30cqw' },
    2: { x: '34cqw', y: '-8cqw' },
    3: { x: '34cqw', y: '26cqw' },
    4: { x: '31cqw', y: '46cqw' },
    5: { x: '-31cqw', y: '46cqw' },
    6: { x: '-34cqw', y: '26cqw' },
    7: { x: '-34cqw', y: '-8cqw' },
    8: { x: '-31cqw', y: '-30cqw' },
  },
};

// フォールド時にカードがテーブル中央へ飛んでいく方向（dealFromOffsetsの逆）
const foldToOffsetsBySeatCount: Record<number, Record<number, { x: string; y: string; rotate: string }>> = {
  6: {
    0: { x: '0', y: '-30cqw', rotate: '-20deg' },
    1: { x: '20cqw', y: '-15cqw', rotate: '15deg' },
    2: { x: '20cqw', y: '15cqw', rotate: '-15deg' },
    3: { x: '0', y: '30cqw', rotate: '20deg' },
    4: { x: '-20cqw', y: '15cqw', rotate: '15deg' },
    5: { x: '-20cqw', y: '-15cqw', rotate: '-15deg' },
  },
  9: {
    0: { x: '0', y: '-30cqw', rotate: '-20deg' },
    1: { x: '20cqw', y: '-20cqw', rotate: '15deg' },
    2: { x: '22cqw', y: '-5cqw', rotate: '-15deg' },
    3: { x: '22cqw', y: '17cqw', rotate: '15deg' },
    4: { x: '20cqw', y: '30cqw', rotate: '-15deg' },
    5: { x: '-20cqw', y: '30cqw', rotate: '20deg' },
    6: { x: '-22cqw', y: '17cqw', rotate: '15deg' },
    7: { x: '-22cqw', y: '-5cqw', rotate: '-15deg' },
    8: { x: '-20cqw', y: '-20cqw', rotate: '-15deg' },
  },
};

const cardPositionStyle = 'top-[-15.5cqw] left-1/2 -translate-x-1/2';

interface PlayerCardsProps {
  player: PlayerType;
  positionIndex: number;
  /** テーブルの席数（6 or 9）。アニメーション方向辞書の切り替えに使う */
  seatCount?: number;
  showCards: boolean;
  isDealing: boolean;
  dealOrder: number;
  lastAction: LastAction | null;
  variant: GameVariant;
  /** ショウダウンでベストハンドに使ったホールカードのインデックス（少し上げて強調） */
  raisedIndices?: number[];
}

export function PlayerCards({
  player,
  positionIndex,
  seatCount = 6,
  showCards,
  isDealing,
  dealOrder,
  lastAction,
  variant,
  raisedIndices,
}: PlayerCardsProps) {
  // ショウダウン時のカード公開アニメーション
  const [isRevealing, setIsRevealing] = useState(false);

  // 表向きで見せる条件。コーチング用ハンドオープンではフォールド済みの席も公開されるため、
  // folded を除外せず「公開カードが来ているか」だけで判定する。
  const isFaceUp = showCards && player.holeCards.length > 0;
  // 降りたハンドは薄く表示して、まだ生きているハンドと区別する
  const isFoldedReveal = isFaceUp && player.folded;

  // useLayoutEffect: paint前に isRevealing を立てないと、showCards が true になった
  // 最初のフレームで全カードが表向きのまま一瞬描画されてしまう
  useLayoutEffect(() => {
    if (isFaceUp) {
      setIsRevealing(true);
      const timer = setTimeout(() => setIsRevealing(false), 1200);
      return () => clearTimeout(timer);
    } else {
      setIsRevealing(false);
    }
  }, [isFaceUp]);

  
  const variantConfig = getVariantConfig(variant);
  const holeCardCount = variantConfig.holeCardCount;
  // 表向きカードの重なりマージン (stud: 7 枚で深く重ねる / PLO6: 6 枚で更に深く / PLO5: 5 枚で少し深く / PLO: 通常)
  const cardOverlapMargin =
    variantConfig.family === 'stud' ? '-ml-[5cqw]' :
    holeCardCount >= 6 ? '-ml-[5cqw]' :
    holeCardCount >= 5 ? '-ml-[4cqw]' :
    '-ml-[2cqw]';
  // 裏向きカードの重なりマージン (PLO: 6cqw / PLO5: 7cqw / PLO6: 8cqw でやや深く)
  const faceDownOverlapMargin =
    holeCardCount >= 6 ? '-ml-[8cqw]' :
    holeCardCount >= 5 ? '-ml-[7cqw]' :
    '-ml-[6cqw]';
  // 6 枚は深く重なるため、表向き時は rank/suit を左上コーナーに寄せて隠れないようにする
  const useCorner = holeCardCount >= 6;

  return (
    <>
      {/* Hole Cards */}
    <div className={`absolute flex z-[15] ${isFoldedReveal ? 'opacity-70' : ''} ${cardPositionStyle}`}>
        {isFaceUp
            ? player.holeCards.map((card, i) => (
                <div
                  key={i}
                  className={`${i > 0 ? cardOverlapMargin : ''} transition-transform duration-200 ${raisedIndices?.includes(i) ? '-translate-y-[2.5cqw]' : ''}`}
                >
                  {isRevealing ? (
                    <div className="w-[11cqw] h-[15.4cqw] relative" style={{ perspective: '100cqw' }}>
                      <div
                        className="w-full h-full animate-reveal-card"
                        style={{
                          transformStyle: 'preserve-3d',
                          animationDelay: `${i * 120}ms`,
                        }}
                      >
                        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
                          <Card card={card} variant={variant} corner={useCorner} />
                        </div>
                        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                          <FaceDownCard />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <Card card={card} variant={variant} corner={useCorner} />
                  )}
                </div>
              ))
            : (player.holeCards.length > 0 ? player.holeCards : Array(holeCardCount).fill(null)).map((card, cardIndex) => {
                const dealDelay = (cardIndex * seatCount + dealOrder) * 40;
                const isFolding = lastAction?.action === 'fold' && Date.now() - lastAction.timestamp < 500;
                const foldOffset = (foldToOffsetsBySeatCount[seatCount] ?? foldToOffsetsBySeatCount[6])[positionIndex];
                return (
                  <div
                    key={cardIndex}
                    className={`${cardIndex > 0 ? faceDownOverlapMargin : ''} ${isDealing ? 'animate-deal-card' : ''} ${isFolding ? 'animate-fold-card' : ''} ${player.folded && !isFolding ? 'invisible' : ''}`}
                    style={isDealing ? {
                      opacity: 0,
                      animationDelay: `${dealDelay}ms`,
                      '--deal-from-x': (dealFromOffsetsBySeatCount[seatCount] ?? dealFromOffsetsBySeatCount[6])[positionIndex].x,
                      '--deal-from-y': (dealFromOffsetsBySeatCount[seatCount] ?? dealFromOffsetsBySeatCount[6])[positionIndex].y,
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
    </>
  );
}
