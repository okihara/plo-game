import { Card as CardType } from '../logic';
import { Card } from './Card';

interface StudMyCardsProps {
  holeCards: CardType[];   // 裏向きカード（2-3枚）
  upCards: CardType[];     // 表向きカード（1-4枚）
  isDealing: boolean;
  dealOrder: number;
  folded?: boolean;
  handName?: string;
}

export function StudMyCards({ holeCards, upCards, isDealing, dealOrder, folded = false, handName }: StudMyCardsProps) {
  return (
    <div
      className={`@container relative flex flex-col items-center justify-center h-[24cqw] bg-transparent transition-all duration-300 ${folded ? 'opacity-40' : ''}`}
    >
      {(holeCards.length > 0 || upCards.length > 0) && (
        <div className="flex gap-[2cqw] justify-center">
          {/* 裏カード（青枠で区別） */}
          {holeCards.map((card, i) => {
            const dealDelay = (i * 6 + dealOrder) * 40;
            return (
              <div
                key={`down-${i}`}
                className={isDealing ? 'animate-deal-card' : ''}
                style={isDealing ? {
                  opacity: 0,
                  animationDelay: `${dealDelay}ms`,
                  '--deal-from-x': '0',
                  '--deal-from-y': '-14vh',
                } as React.CSSProperties : {}}
              >
                <div className="ring-2 ring-blue-400/50 rounded-[1cqw]">
                  <Card card={card} size="lg" />
                </div>
              </div>
            );
          })}
          {/* 表カード */}
          {upCards.map((card, i) => (
            <div key={`up-${i}`}>
              <Card card={card} size="lg" />
            </div>
          ))}
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
