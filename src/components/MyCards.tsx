import { Card as CardType, isStudFamily, isDrawFamily, GameVariant } from '../logic';
import { Card } from './Card';

interface MyCardsProps {
  cards: CardType[];
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
  folded?: boolean;
  handName?: string;
  variant?: string;
  isDrawPhase?: boolean;
  selectedCardIndices?: Set<number>;
  onCardToggle?: (index: number) => void;
}

export function MyCards({ cards, isDealing, dealOrder, folded = false, handName, variant, isDrawPhase, selectedCardIndices, onCardToggle }: MyCardsProps) {
  const v = (variant ?? 'plo') as GameVariant;
  const isStud = isStudFamily(v);
  const isDraw = isDrawFamily(v);
  const useSmallCards = isStud || isDraw;

  return (
    <div
      className={`@container relative flex flex-col items-center justify-center h-[24cqw] bg-transparent transition-all duration-300 ${folded ? 'brightness-[0.3]' : ''}`}
    >
      {cards.length > 0 && (
      <div className={`flex ${useSmallCards ? 'gap-[1cqw]' : 'gap-[2cqw]'} justify-center`}>
        {cards.map((card, cardIndex) => {
          const dealDelay = (cardIndex * 6 + dealOrder) * 40;
          const isSelected = isDrawPhase && selectedCardIndices?.has(cardIndex);
          return (
            <div
              key={cardIndex}
              className={`transition-transform duration-150 ${card.isUp ? '-translate-y-[4cqw]' : ''} ${isSelected ? '-translate-y-[3cqw]' : ''} ${isDealing ? 'animate-deal-card' : ''} ${isDrawPhase ? 'cursor-pointer' : ''}`}
              style={isDealing ? {
                opacity: 0,
                animationDelay: `${dealDelay}ms`,
                '--deal-from-x': '0',
                '--deal-from-y': '-14vh',
              } as React.CSSProperties : {}}
              onClick={isDrawPhase && onCardToggle ? () => onCardToggle(cardIndex) : undefined}
            >
              <div className="relative">
                <Card card={card} size={useSmallCards ? 'sm' : 'lg'} />
                {isSelected && (
                  <div className="absolute -top-[1.5cqw] left-1/2 -translate-x-1/2 w-[3cqw] h-[3cqw] rounded-full bg-red-500 border-2 border-white shadow-md" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}
      {isDrawPhase && selectedCardIndices && selectedCardIndices.size > 0 && (
        <div className="absolute bottom-[1cqw] left-1/2 -translate-x-1/2 text-[3.5cqw] font-bold text-red-400 whitespace-nowrap bg-black/90 px-[2cqw] py-[0.5cqw] rounded">
          {selectedCardIndices.size}枚を交換
        </div>
      )}
      {!isDrawPhase && handName && (
        <div className="absolute bottom-[1cqw] left-1/2 -translate-x-1/2 text-[4.5cqw] font-bold text-amber-300 whitespace-nowrap bg-black/90 px-[2cqw] py-[0.5cqw] rounded">
          {handName}
        </div>
      )}
    </div>
  );
}
