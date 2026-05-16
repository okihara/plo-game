const SUIT_SYMBOLS: Record<string, string> = {
  h: '\u2665', d: '\u2666', c: '\u2663', s: '\u2660',
};
const SUIT_BORDER_COLORS: Record<string, string> = {
  h: 'border-red-500', d: 'border-blue-500', c: 'border-green-600', s: 'border-gray-700',
};
const SUIT_TEXT_COLORS: Record<string, string> = {
  h: 'text-red-600', d: 'text-blue-600', c: 'text-green-700', s: 'text-gray-800',
};

export function MiniCard({ cardStr }: { cardStr: string }) {
  const rank = cardStr.slice(0, -1);
  const suit = cardStr.slice(-1);
  const symbol = SUIT_SYMBOLS[suit] || suit;
  const borderColor = SUIT_BORDER_COLORS[suit] || 'border-gray-400';
  const textColor = SUIT_TEXT_COLORS[suit] || 'text-gray-800';

  return (
    <span className={`inline-flex items-center justify-center bg-white ${textColor} border-[0.1cqw] ${borderColor} rounded-[0.8cqw] px-[1.6cqw] py-[0.8cqw] text-[3cqw] font-mono font-bold leading-none shadow-sm`}>
      {rank}{symbol}
    </span>
  );
}

export function parseBB(blinds: string): number {
  const parts = blinds.split('/');
  return Number(parts[parts.length - 1]) || 1;
}

function formatBBValue(chips: number, bb: number): string {
  const val = chips / bb;
  const abs = Math.abs(val);
  const formatted = abs === Math.floor(abs) ? abs.toString() : abs.toFixed(1);
  if (val > 0) return `+${formatted}`;
  if (val < 0) return `-${formatted}`;
  return '0';
}

export function ProfitDisplay({ profit, size = 'normal', bb }: { profit: number; size?: 'normal' | 'large'; bb?: number }) {
  const textSize = size === 'large' ? 'text-[3.5cqw]' : 'text-[3cqw]';
  const suffix = bb ? 'bb' : '';

  if (bb) {
    const display = formatBBValue(profit, bb);
    const isPositive = profit > 0;
    const isNegative = profit < 0;
    return (
      <span className={`font-bold ${textSize} ${isPositive ? 'text-forest' : isNegative ? 'text-[#C0392B]' : 'text-cream-700'}`}>
        {display}{suffix}
      </span>
    );
  }

  if (profit > 0) {
    return <span className={`text-forest font-bold ${textSize}`}>+{profit}</span>;
  }
  if (profit < 0) {
    return <span className={`text-[#C0392B] font-bold ${textSize}`}>-{Math.abs(profit)}</span>;
  }
  return <span className={`text-cream-700 ${textSize}`}>0</span>;
}

export function getPositionName(seatPosition: number, dealerPosition: number, allSeatPositions: number[]): string {
  if (dealerPosition < 0) return '';
  const sorted = [...allSeatPositions].sort((a, b) => {
    const offsetA = (a - dealerPosition + 6) % 6;
    const offsetB = (b - dealerPosition + 6) % 6;
    return offsetA - offsetB;
  });
  const index = sorted.indexOf(seatPosition);
  const count = sorted.length;
  if (count <= 1) return '';
  if (count === 2) return index === 0 ? 'SB' : 'BB';
  const posMap: Record<number, string[]> = {
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'CO'],
    5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  };
  const positions = posMap[count] || posMap[6]!;
  return positions[index] || '';
}

export function PositionBadge({ position }: { position: string }) {
  if (!position) return null;
  return (
    <span className="bg-cream-200 text-cream-800 text-[2.5cqw] font-bold w-[7cqw] h-[4cqw] text-center rounded-[0.5cqw] border border-cream-400 shrink-0 inline-block">
      {position}
    </span>
  );
}
