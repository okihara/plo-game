import { Card as CardType } from '../logic';
import { Card, FaceDownCard } from './Card';

interface CommunityCardsProps {
  cards: CardType[];
  newCardsCount: number;
}

export function CommunityCards({ cards, newCardsCount }: CommunityCardsProps) {
  const emptySlots = 5 - cards.length;

  return (
    <div className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex gap-[0.7cqw] z-[5]">
      {cards.map((card, index) => {
        const isNew = index >= cards.length - newCardsCount && newCardsCount > 0;
        return <Card key={index} card={card} size="md" isNew={isNew} />;
      })}
      {Array(emptySlots)
        .fill(null)
        .map((_, i) => (
          <div key={`empty-${i}`} className="opacity-30">
            <FaceDownCard size="md" />
          </div>
        ))}
    </div>
  );
}
