import { Card as CardType, evaluatePreFlopStrength } from '../logic';
import { Card } from './Card';

interface MyCardsProps {
  cards: CardType[];
  isDealing: boolean;
  dealOrder: number; // SBからの配布順序（0-5）
}

// ハンド強度を%表示に変換（上位何%のハンドかを示す）
// スコアが高いほど強いハンド = 上位に位置する
function getHandPercentile(strength: number): number {
  // strength: 0-1のスコア
  // 上位%に変換: 強度1.0 = 上位0%, 強度0.0 = 上位100%
  return Math.round((1 - strength) * 100);
}

// ハンド強度に応じた色を返す
function getStrengthColor(percentile: number): string {
  if (percentile <= 10) return 'text-yellow-300'; // プレミアムハンド（上位10%）
  if (percentile <= 25) return 'text-green-400';  // 強いハンド（上位25%）
  if (percentile <= 50) return 'text-blue-400';   // 中程度（上位50%）
  return 'text-gray-400'; // 弱いハンド
}

export function MyCards({ cards, isDealing, dealOrder }: MyCardsProps) {
  if (cards.length === 0) return null;

  const strength = evaluatePreFlopStrength(cards);
  const percentile = getHandPercentile(strength);

  return (
    <div
      className="flex flex-col items-center py-2.5 bg-gradient-to-b from-transparent to-black/30"
    >
      <div className="flex gap-1.5 justify-center">
        {cards.map((card, cardIndex) => {
          // 1枚ずつ全員に配る: 1周目(cardIndex=0)はSBから順に、2周目(cardIndex=1)も同様...
          const dealDelay = (cardIndex * 6 + dealOrder) * 80;
          return (
            <div
              key={cardIndex}
              className={isDealing ? 'animate-deal-card' : ''}
              style={isDealing ? {
                opacity: 0,
                animationDelay: `${dealDelay}ms`,
                '--deal-from-x': '0px',
                '--deal-from-y': '-120px',
              } as React.CSSProperties : {}}
            >
              <Card card={card} size="lg" />
            </div>
          );
        })}
      </div>
      <div
        className={`mt-1 text-xs font-medium ${getStrengthColor(percentile)} ${isDealing ? 'opacity-0' : ''}`}
        style={isDealing ? {} : { transition: 'opacity 0.3s ease' }}
      >
        Top {percentile}%
      </div>
    </div>
  );
}
