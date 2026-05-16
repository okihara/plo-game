import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Card as CardType, GameState } from '../logic/types';
import { useGameSettings } from '../contexts/GameSettingsContext';
import { MiniCard, PositionBadge } from './HandHistoryUtils';

function cardToHistoryStr(c: CardType): string {
  return `${c.rank}${c.suit}`;
}

function cardsTitle(cards: CardType[]): string {
  if (cards.length === 0) return '';
  return cards.map(c => (c.isUp === false ? '?' : cardToHistoryStr(c))).join(' ');
}

/** MiniCard と同寸の裏向き（ハンド履歴に裏がないためローカル） */
function SpectatorFaceDownMini() {
  return (
    <span
      className="inline-flex items-center justify-center bg-gradient-to-br from-slate-500 to-slate-800 text-white/75 border-[0.1cqw] border-slate-400 rounded-[0.8cqw] px-[1.6cqw] py-[0.8cqw] text-[3cqw] font-mono font-bold leading-none shadow-sm"
      aria-hidden
    >
      ??
    </span>
  );
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

  const rows = gameState.players
    .map((p, seatIndex) => ({ p, seatIndex }))
    .filter(({ p }) => !p.isSittingOut);

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
          return (
            <div
              key={seatIndex}
              className={`flex items-center gap-[1cqw] min-w-0 shrink-0 ${p.folded ? 'opacity-45 brightness-90' : ''}`}
            >
              {/* 固定幅: カード列の左端を全行で揃える（狭めてカードを左へ） */}
              <div
                className="w-[48cqw] shrink-0 flex items-center gap-[0.7cqw] min-w-0"
                title={`${p.name} · ${formatSpectatorStackDisplay(p.chips, settings.useBBNotation, stackBb)}`}
              >
                <span
                  className="text-white/50 tabular-nums font-medium w-[5.2cqw] shrink-0 text-right"
                  style={{ fontSize: '2.6cqw' }}
                >
                  #{seatIndex + 1}
                </span>
                <div className="shrink-0">{p.position ? <PositionBadge position={p.position} /> : null}</div>
                <span
                  className="text-white/95 font-medium truncate min-w-0 flex-1"
                  style={{ fontSize: '2.6cqw' }}
                >
                  {p.name}
                </span>
                <span
                  className="text-amber-200/95 font-semibold tabular-nums shrink-0"
                  style={{ fontSize: '2.4cqw' }}
                >
                  {formatSpectatorStackDisplay(p.chips, settings.useBBNotation, stackBb)}
                </span>
              </div>
              <div
                className="flex flex-nowrap items-center gap-[0.6cqw] min-w-0 flex-1"
                title={cardsTitle(cards)}
              >
                {cards.length === 0 ? (
                  <span className="text-white/35" style={{ fontSize: '2.8cqw' }}>
                    —
                  </span>
                ) : (
                  cards.map((c, i) =>
                    c.isUp === false ? (
                      <SpectatorFaceDownMini key={i} />
                    ) : (
                      <MiniCard key={i} cardStr={cardToHistoryStr(c)} />
                    )
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
