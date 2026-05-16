import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Card as CardType, GameState } from '../logic/types';
import { useGameSettings } from '../contexts/GameSettingsContext';

function cardToHistoryStr(c: CardType): string {
  return `${c.rank}${c.suit}`;
}

interface SpectatorAllHandsProps {
  gameState: GameState;
  holeCardsBySeat: Map<number, CardType[]>;
  nav?: {
    label: string;
    onPrevious: () => void;
    onNext: () => void;
    canGoPrevious: boolean;
    canGoNext: boolean;
  };
}

/** K/M 略記なし。bb は bigBlind で算出 */
function formatBbCount(amount: number, bigBlind: number): string {
  if (bigBlind <= 0) return '—';
  const bb = amount / bigBlind;
  return bb === Math.floor(bb) ? `${bb}bb` : `${bb.toFixed(1)}bb`;
}

/** 観戦スタック: チップと (bb) を両方。bb 表記ONのときは先にbb、括弧はチップ */
function formatSpectatorStackDisplay(amount: number, useBBNotation: boolean, bigBlind: number): string {
  const chipsStr = String(amount);
  const bbStr = formatBbCount(amount, bigBlind);
  if (bigBlind <= 0) {
    return chipsStr;
  }
  if (useBBNotation) {
    return `${bbStr} (${chipsStr})`;
  }
  return `${chipsStr} (${bbStr})`;
}

export function SpectatorAllHands({ gameState, holeCardsBySeat, nav }: SpectatorAllHandsProps) {
  const { settings } = useGameSettings();
  // bomb pot は bigBlind=0 / ante=N なので ante を BB 相当として扱う
  const effectiveBb = gameState.bigBlind || gameState.ante;
  const stackBb = effectiveBb > 0 ? effectiveBb : settings.bigBlind;

  const rows = gameState.players.map((p, seatIndex) => ({ p, seatIndex }));

  if (rows.length === 0) return null;

  return (
    <div className="py-[5cqw]">
      <div className="rounded-[2cqw] bg-black border-[0.3cqw] border-white/15 px-[2cqw] py-[2cqw] flex flex-col gap-[0.1cqw] h-[43cqw] overflow-hidden">
        {nav && (
          <div className="flex items-center justify-between gap-[1cqw] pb-[0.6cqw] border-b border-white/10 shrink-0">
            <button
              type="button"
              onClick={nav.onPrevious}
              disabled={!nav.canGoPrevious}
              title="前のテーブル"
              aria-label="前のテーブル"
              className="flex items-center justify-center w-[7cqw] h-[4.5cqw] text-white/85 hover:text-white rounded-[0.8cqw] bg-white/10 border border-white/15 disabled:opacity-35 disabled:pointer-events-none"
            >
              <ChevronLeft className="w-[3.5cqw] h-[3.5cqw]" />
            </button>
            <span className="text-white/85 tabular-nums" style={{ fontSize: '2.8cqw' }}>
              {nav.label}
            </span>
            <button
              type="button"
              onClick={nav.onNext}
              disabled={!nav.canGoNext}
              title="次のテーブル"
              aria-label="次のテーブル"
              className="flex items-center justify-center w-[7cqw] h-[4.5cqw] text-white/85 hover:text-white rounded-[0.8cqw] bg-white/10 border border-white/15 disabled:opacity-35 disabled:pointer-events-none"
            >
              <ChevronRight className="w-[3.5cqw] h-[3.5cqw]" />
            </button>
          </div>
        )}
        {rows.map(({ p, seatIndex }) => {
          const cards = holeCardsBySeat.has(seatIndex)
            ? (holeCardsBySeat.get(seatIndex) ?? [])
            : (p.holeCards ?? []);
          if (p.isSittingOut) {
            return (
              <div key={seatIndex} style={{ display: 'flex', opacity: 0.35, fontSize: '3cqw' }}>
                <div style={{ width: '64%', display: 'flex', gap: 4 }}>
                  <span>#{seatIndex + 1}</span>
                  <span style={{ flex: 1 }}>EMPTY</span>
                </div>
              </div>
            );
          }
          return (
            <div key={seatIndex} style={{ display: 'flex', opacity: p.folded ? 0.45 : 1, fontSize: '3cqw' }}>
              <div style={{ width: '64%', display: 'flex', gap: 4 }}>
                <span>#{seatIndex + 1}</span>
                <span
                  style={{
                    background: p.position ? '#fff' : 'transparent',
                    color: '#000',
                    width: '7cqw',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {p.position ?? ''}
                </span>
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ color: '#fcd34d' }}>{formatSpectatorStackDisplay(p.chips, settings.useBBNotation, stackBb)}</span>
              </div>
              <div style={{ display: 'flex', flex: 1, gap: 4, justifyContent: 'flex-end' }}>
                {cards.length === 0
                  ? '—'
                  : cards.map((c, i) => (
                      <span key={i}>{c.isUp === false ? '??' : cardToHistoryStr(c)}</span>
                    ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
