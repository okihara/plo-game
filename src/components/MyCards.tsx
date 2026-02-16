import { Card as CardType } from '../logic';
import { Card } from './Card';

interface MyCardsProps {
  cards: CardType[];
  communityCards: CardType[];
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
  folded?: boolean;
  handName?: string;
}

export function MyCards({ cards, isDealing, dealOrder, folded = false, handName }: MyCardsProps) {
  return (
    <div
      className={`@container flex flex-col items-center justify-center h-[24cqw] bg-gradient-to-b from-transparent to-black/30 transition-all duration-300 ${folded ? 'opacity-40' : ''}`}
    >
      {cards.length > 0 && (
      <div className="flex gap-[2cqw] justify-center">
        {cards.map((card, cardIndex) => {
          // 1枚ずつ全員に配る: 1周目(cardIndex=0)はSBから順に、2周目(cardIndex=1)も同様...
          const dealDelay = (cardIndex * 6 + dealOrder) * 40;
          return (
            <div
              key={cardIndex}
              className={isDealing ? 'animate-deal-card' : ''}
              style={isDealing ? {
                opacity: 0,
                animationDelay: `${dealDelay}ms`,
                '--deal-from-x': '0',
                '--deal-from-y': '-14vh',
              } as React.CSSProperties : {}}
            >
              <Card card={card} size="lg" />
            </div>
          );
        })}
      </div>
      )}
      {handName && !folded && (
        <div className="text-[3.5cqw] font-bold text-amber-300 mt-[1cqw]">
          {handName}
        </div>
      )}
    </div>
  );
}
