import type { Card as CardType, GameState } from '../logic/types';

const SUIT_CHARS: Record<string, string> = {
  h: '♥',
  d: '♦',
  c: '♣',
  s: '♠',
};

/** 観戦表示用: 裏・非公開は「?」、表向きは rank+suit */
function formatHoleCardText(c: CardType): string {
  if (c.isUp === false) return '?';
  const suit = SUIT_CHARS[c.suit] ?? c.suit;
  return `${c.rank}${suit}`;
}

function formatHoleLine(cards: CardType[]): string {
  if (cards.length === 0) return '—';
  return cards.map(formatHoleCardText).join(' ');
}

interface SpectatorAllHandsProps {
  gameState: GameState;
  holeCardsBySeat: Map<number, CardType[]>;
}

export function SpectatorAllHands({ gameState, holeCardsBySeat }: SpectatorAllHandsProps) {
  const rows = gameState.players
    .map((p, seatIndex) => ({ p, seatIndex }))
    .filter(({ p }) => !p.isSittingOut);

  if (rows.length === 0) return null;

  return (
    <div
      className="@container w-full flex-shrink-0 px-[2cqw] pt-[1cqw] pb-[2cqw] max-h-[36cqw] overflow-y-auto"
      style={{ scrollbarGutter: 'stable' }}
    >
      <div className="rounded-[2cqw] bg-black/40 border border-white/15 px-[2cqw] py-[1.5cqw] flex flex-col gap-[1.2cqw]">
        {rows.map(({ p, seatIndex }) => {
          const cards = holeCardsBySeat.has(seatIndex)
            ? (holeCardsBySeat.get(seatIndex) ?? [])
            : (p.holeCards ?? []);
          return (
            <div
              key={seatIndex}
              className={`flex items-start gap-[1.5cqw] min-w-0 ${p.folded ? 'opacity-45 brightness-90' : ''}`}
            >
              <div
                className="flex-shrink-0 text-white/95 font-medium tabular-nums truncate max-w-[28cqw]"
                style={{ fontSize: '2.8cqw' }}
                title={p.name}
              >
                <span className="text-white/50 mr-[1cqw]">#{seatIndex + 1}</span>
                {p.name}
              </div>
              <div
                className="flex-1 min-w-0 text-white/90 font-mono tracking-tight break-all"
                style={{ fontSize: '2.6cqw', lineHeight: 1.35 }}
                title={formatHoleLine(cards)}
              >
                {formatHoleLine(cards)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
