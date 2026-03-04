import { Card as CardType } from '../logic';

// === 定数・型 ===

type CardSize = 'sm' | 'md' | 'lg';
type CardVariant = 'plo' | 'stud';

const SUIT_SYMBOLS: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠',
};

const SUIT_BG_COLORS: Record<string, string> = {
  h: 'bg-red-600',
  d: 'bg-blue-600',
  c: 'bg-green-700',
  s: 'bg-gray-800',
};

const sizeStyles: Record<CardSize, { card: string; suit: string; corner: string }> = {
  sm: { card: 'w-[11cqw] h-[15.4cqw] text-[6.4cqw]', suit: 'text-[6.4cqw]', corner: 'text-[4cqw]' },
  md: { card: 'w-[14cqw] h-[20.5cqw] text-[7.9cqw]', suit: 'text-[7.9cqw]', corner: 'text-[5cqw]' },
  lg: { card: 'w-[13cqw] h-[18cqw] text-[7cqw]', suit: 'text-[7cqw]', corner: 'text-[4.5cqw]' },
};

const faceDownSizeStyles: Record<CardSize, string> = {
  sm: 'w-[11cqw] h-[15.4cqw]',
  md: 'w-[14cqw] h-[20.5cqw]',
  lg: 'w-[13cqw] h-[18cqw]',
};

// === 基本コンポーネント ===

interface FaceCardProps {
  card: CardType;
  size?: CardSize;
  variant?: CardVariant;
  className?: string;
  style?: React.CSSProperties;
}

export function FaceCard({ card, size = 'sm', variant = 'plo', className = '', style }: FaceCardProps) {
  const suitSymbol = SUIT_SYMBOLS[card.suit];
  const suitBg = SUIT_BG_COLORS[card.suit];
  const styles = sizeStyles[size];
  const isStud = variant === 'stud';

  return (
    <div
      className={`
        flex flex-col items-center justify-center
        ${suitBg} text-white border border-white/40
        rounded-lg shadow-md relative
        ${styles.card}
        ${className}
      `}
      style={style}
    >
      {isStud && (
        <div className={`absolute top-[0.5cqw] left-[0.5cqw] flex flex-col items-center leading-none font-bold ${styles.corner}`}>
          <span>{card.rank}</span>
          <span>{suitSymbol}</span>
        </div>
      )}
      {!isStud && (
        <>
          <span className="leading-none font-bold">{card.rank}</span>
          <span className={`leading-none ${styles.suit}`}>{suitSymbol}</span>
        </>
      )}
    </div>
  );
}

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

// === 複合コンポーネント ===

interface CardProps {
  card: CardType;
  size?: CardSize;
  isNew?: boolean;
  variant?: CardVariant;
}

export function Card({ card, size = 'sm', isNew = false, variant = 'plo' }: CardProps) {
  if (!isNew) {
    return <FaceCard card={card} size={size} variant={variant} />;
  }

  const styles = sizeStyles[size];

  // 3Dフリップアニメーション: 裏面→表面
  return (
    <div
      className={`${styles.card} relative`}
      style={{ perspective: '400px' }}
    >
      <div
        className="w-full h-full animate-flip-card"
        style={{ transformStyle: 'preserve-3d' }}
      >
        <FaceCard
          card={card}
          size={size}
          variant={variant}
          className="absolute inset-0"
          style={{ backfaceVisibility: 'hidden' }}
        />
        <div
          className="absolute inset-0 bg-gradient-to-br from-blue-800 to-blue-950 border border-blue-500 rounded-lg shadow-md overflow-hidden"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
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
      </div>
    </div>
  );
}
