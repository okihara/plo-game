import { Card as CardType } from '../logic';
import { Card, FaceDownCard } from './Card';

type CardSize = 'xs' | 'sm' | 'md' | 'lg';

interface CommunityCardsProps {
  cards: CardType[];
  newCardsCount: number;
  /** デフォルト top-[70.02cqw]。bomb pot の 2 ボード描画用に上書き可能 */
  topClass?: string;
  /** "Board 1" 等のラベルを左に小さく表示する */
  label?: string;
  /** カードサイズ。bomb pot は 'xs'（縦半分・rank左/suit右の横並び）を渡す */
  cardSize?: CardSize;
}

export function CommunityCards({ cards, newCardsCount, topClass = 'top-[70.02cqw]', label, cardSize = 'md' }: CommunityCardsProps) {
  const emptySlots = 5 - cards.length;

  return (
    <div className={`absolute ${topClass} left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-[0.7cqw] z-[5]`}>
      {label && (
        <span className="absolute right-full mr-[1.5cqw] bg-black/70 text-white text-[3cqw] uppercase tracking-wider whitespace-nowrap rounded-[0.8cqw] px-[1.2cqw] py-[1cqw] leading-none">
          {label}
        </span>
      )}
      {cards.map((card, index) => {
        const isNew = index >= cards.length - newCardsCount && newCardsCount > 0;
        return <Card key={index} card={card} size={cardSize} isNew={isNew} />;
      })}
      {Array(emptySlots)
        .fill(null)
        .map((_, i) => (
          <div key={`empty-${i}`} className="opacity-30">
            <FaceDownCard size={cardSize} />
          </div>
        ))}
    </div>
  );
}
