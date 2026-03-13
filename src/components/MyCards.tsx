import { useRef, useEffect, useState } from 'react';
import { Card as CardType, getVariantConfig, GameVariant } from '../logic';
import { Card } from './Card';

function cardKey(c: CardType): string {
  return `${c.rank}${c.suit}`;
}

interface MyCardsProps {
  cards: CardType[];
  dealOrder: number; // SBからの配布順序（0-5）
  folded?: boolean;
  handName?: string;
  variant?: string;
  isDrawPhase?: boolean;
  selectedCardIndices?: Set<number>;
  onCardToggle?: (index: number) => void;
}

export function MyCards({ cards, dealOrder, folded = false, handName, variant, isDrawPhase, selectedCardIndices, onCardToggle }: MyCardsProps) {
  const v = (variant ?? 'plo') as GameVariant;
  const config = getVariantConfig(v);
  const useSmallCards = config.family === 'stud' || config.family === 'draw';

  // 前回のカードを保持して差分だけアニメーションさせる
  const prevCardsRef = useRef<string[]>([]);
  const [animatingIndices, setAnimatingIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (cards.length === 0) {
      prevCardsRef.current = [];
      setAnimatingIndices(new Set());
      return;
    }

    const prevKeys = new Set(prevCardsRef.current);
    const newIndices = new Set<number>();
    cards.forEach((card, i) => {
      if (!prevKeys.has(cardKey(card))) {
        newIndices.add(i);
      }
    });

    prevCardsRef.current = cards.map(cardKey);

    if (newIndices.size === 0) return;
    setAnimatingIndices(newIndices);
  }, [cards]);

  return (
    <div
      className={`@container relative flex flex-col items-center justify-end h-[24cqw] bg-transparent transition-all duration-300 ${folded ? 'brightness-[0.3]' : ''}`}
    >
      {cards.length > 0 && (
      <div className={`flex ${useSmallCards ? 'gap-[1cqw]' : 'gap-[1cqw]'} justify-center`}>
        {(() => {
          // 差分カード内での順番マップ（cardIndex → 0,1,2...）
          const animOrderMap = new Map<number, number>();
          [...animatingIndices].sort((a, b) => a - b).forEach((idx, order) => animOrderMap.set(idx, order));
          return cards.map((card, cardIndex) => {
            const shouldAnimate = animatingIndices.has(cardIndex);
            const dealDelay = ((animOrderMap.get(cardIndex) ?? 0) * 6 + dealOrder) * 40;
            const isSelected = isDrawPhase && selectedCardIndices?.has(cardIndex);
            return (
              <div
                key={cardIndex}
                className={`transition-transform duration-150 ${card.isUp ? '-translate-y-[4cqw]' : ''} ${isSelected ? '-translate-y-[3cqw]' : ''} ${shouldAnimate ? 'animate-deal-card' : ''} ${isDrawPhase ? 'cursor-pointer' : ''}`}
                style={shouldAnimate ? {
                  opacity: 0,
                  animationDelay: `${dealDelay}ms`,
                  '--deal-from-x': '0',
                  '--deal-from-y': '-14cqw',
                  '--deal-to-y': card.isUp ? '-4cqw' : '0',
                } as React.CSSProperties : {}}
                onClick={isDrawPhase && onCardToggle ? () => onCardToggle(cardIndex) : undefined}
              >
                <div className="relative">
                <Card card={card} size={useSmallCards ? 'sm' : 'lg'} />
                {/* 丸のポッチ */}
                {isSelected && (
                    <div className="absolute -top-[1.5cqw] left-1/2 -translate-x-1/2 w-[3cqw] h-[3cqw] rounded-full bg-red-500 border-2 border-white shadow-md" />
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
      )}
      {isDrawPhase && selectedCardIndices && selectedCardIndices.size > 0 && (
        <div className="absolute bottom-[1cqw] left-1/2 -translate-x-1/2 text-[3.5cqw] font-bold text-red-400 whitespace-nowrap bg-black/90 px-[2cqw] py-[0.5cqw] rounded">
          {selectedCardIndices.size}枚を交換
        </div>
      )}
      {!isDrawPhase && handName && (
        <div className="absolute bottom-[-2cqw] left-1/2 -translate-x-1/2 text-[4.5cqw] font-bold text-amber-300 whitespace-nowrap bg-black/90 px-[2cqw] py-[0.5cqw] rounded">
          {handName}
        </div>
      )}
    </div>
  );
}
