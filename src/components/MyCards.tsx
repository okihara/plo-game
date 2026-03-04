import { Card as CardType } from '../logic';
import { Card } from './Card';

interface MyCardsProps {
  cards: CardType[];
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
  folded?: boolean;
  handName?: string;
  variant?: string;
}

export function MyCards({ cards, isDealing, dealOrder, folded = false, handName, variant }: MyCardsProps) {
  const isStud = variant === 'stud';

  return (
    <div
      className={`@container relative flex flex-col items-center justify-center h-[24cqw] bg-transparent transition-all duration-300 ${folded ? 'brightness-[0.3]' : ''}`}
    >
      {cards.length > 0 && (
      <div className={`flex ${isStud ? 'gap-[1cqw]' : 'gap-[2cqw]'} justify-center`}>
        {cards.map((card, cardIndex) => {
          const dealDelay = (cardIndex * 6 + dealOrder) * 40;
          return (
            <div
              key={cardIndex}
              className={`${isStud && card.isUp ? '-translate-y-[4cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''}`}
              style={isDealing ? {
                opacity: 0,
                animationDelay: `${dealDelay}ms`,
                '--deal-from-x': '0',
                '--deal-from-y': '-14vh',
              } as React.CSSProperties : {}}
            >
              <Card card={card} size={isStud ? 'sm' : 'lg'} />
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
