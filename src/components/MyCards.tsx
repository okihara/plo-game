import { Card as CardType } from '../logic';
import { Card } from './Card';

interface MyCardsProps {
  cards: CardType[];
  isDealing: boolean;
}

export function MyCards({ cards, isDealing }: MyCardsProps) {
  if (cards.length === 0) return null;

  return (
    <div
      className={`flex gap-1.5 justify-center py-2.5 bg-gradient-to-b from-transparent to-black/30 ${
        isDealing ? 'opacity-0' : ''
      }`}
    >
      {cards.map((card, i) => (
        <div key={i} className="w-[52px] h-[72px] shadow-lg">
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-white to-gray-100 rounded text-lg font-bold">
            <Card card={card} large />
          </div>
        </div>
      ))}
    </div>
  );
}
