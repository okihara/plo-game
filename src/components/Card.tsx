import { Card as CardType } from '../logic';

const SUIT_SYMBOLS: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠',
};

type CardSize = 'sm' | 'md' | 'lg';

const sizeStyles: Record<CardSize, { card: string; suit: string }> = {
  sm: { card: 'w-8 h-11 text-sm', suit: 'text-base' },
  md: { card: 'w-10 h-14 text-lg', suit: 'text-xl' },
  lg: { card: 'w-14 h-20 text-xl', suit: 'text-2xl' },
};

interface CardProps {
  card: CardType;
  size?: CardSize;
  isNew?: boolean;
}

export function Card({ card, size = 'sm', isNew = false }: CardProps) {
  const isRed = card.suit === 'h' || card.suit === 'd';
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const styles = sizeStyles[size];

  return (
    <div
      className={`
        flex flex-col items-center justify-center
        bg-gradient-to-br from-white to-gray-100
        rounded shadow-md relative
        ${styles.card}
        ${isRed ? 'text-red-600' : 'text-blue-900'}
        ${isNew ? 'animate-flip-card' : ''}
      `}
    >
      <span className="leading-none font-bold">{card.rank}</span>
      <span className={`leading-none ${styles.suit}`}>{suitSymbol}</span>
    </div>
  );
}

const faceDownSizeStyles: Record<CardSize, string> = {
  sm: 'w-8 h-11',
  md: 'w-10 h-14',
  lg: 'w-14 h-20',
};

interface FaceDownCardProps {
  size?: CardSize;
}

export function FaceDownCard({ size = 'sm' }: FaceDownCardProps) {
  return (
    <div
      className={`
        bg-gradient-to-br from-blue-800 to-blue-950
        border border-blue-500 rounded shadow-md
        relative overflow-hidden
        ${faceDownSizeStyles[size]}
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
