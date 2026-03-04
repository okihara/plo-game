import { Card as CardType } from '../logic';
import { Card } from './Card';

interface StudMyCardsProps {
  cards: CardType[];      // 全カード配布順（isUpで表裏区別）
  isDealing: boolean;
  dealOrder: number;
  folded?: boolean;
  handName?: string;
}

export function StudMyCards({ cards, isDealing, dealOrder, folded = false, handName }: StudMyCardsProps) {
  return (
    <div
      className={`@container relative flex flex-col items-center justify-center h-[24cqw] bg-transparent transition-all duration-300 ${folded ? 'opacity-40' : ''}`}
    >
      {cards.length > 0 && (
        <div className="flex gap-[2cqw] justify-center">
          {cards.map((card, i) => {
            const dealDelay = (i * 6 + dealOrder) * 40;
            return (
              <div
                key={i}
                className={`${card.isUp ? '-translate-y-[4cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''}`}
                style={isDealing ? {
                  opacity: 0,
                  animationDelay: `${dealDelay}ms`,
                  '--deal-from-x': '0',
                  '--deal-from-y': '-14vh',
                } as React.CSSProperties : {}}
              >
                {card.isUp ? (
                  <Card card={card} size="sm" />
                ) : (
                  <div className="ring-2 ring-blue-400/50 rounded-[1cqw]">
                    <Card card={card} size="sm" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {handName && (
        <div className="absolute bottom-[1cqw] left-1/2 -translate-x-1/2 text-[4.5cqw] font-bold text-amber-300 whitespace-nowrap bg-black/90 px-[2cqw] py-[0.5cqw] rounded">
          {handName}
        </div>
      )}
    </div>
  );
}
