import { Card as CardType } from '../logic';

const SUIT_SYMBOLS: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠',
};

interface CardProps {
  card: CardType;
  large?: boolean;
  isNew?: boolean;
}

export function Card({ card, large = false, isNew = false }: CardProps) {
  const isRed = card.suit === 'h' || card.suit === 'd';
  const suitSymbol = SUIT_SYMBOLS[card.suit];

  return (
    <div
      className={`
        flex flex-col items-center justify-center
        bg-gradient-to-br from-white to-gray-100
        rounded shadow-md relative
        ${large ? 'w-10 h-14 text-sm' : 'w-8 h-11 text-xs'}
        ${isRed ? 'text-red-600' : 'text-blue-900'}
        ${isNew ? 'animate-flip-card' : ''}
      `}
    >
      <span className="leading-none font-bold">{card.rank}</span>
      <span className={`leading-none ${large ? 'text-lg' : 'text-sm'}`}>{suitSymbol}</span>
    </div>
  );
}

interface FaceDownCardProps {
  large?: boolean;
}

export function FaceDownCard({ large = false }: FaceDownCardProps) {
  return (
    <div
      className={`
        bg-gradient-to-br from-blue-800 to-blue-950
        border border-blue-500 rounded shadow-md
        relative overflow-hidden
        ${large ? 'w-10 h-14' : 'w-8 h-11'}
      `}
    >
      <div
        className="absolute inset-0 opacity-10"
        style={{
          background: `repeating-linear-gradient(
            45deg,
            transparent,
            transparent 3px,
            rgba(255,255,255,0.3) 3px,
            rgba(255,255,255,0.3) 6px
          )`,
        }}
      />
    </div>
  );
}
