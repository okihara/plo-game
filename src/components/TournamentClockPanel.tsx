import { useEffect, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { ClientTournamentState } from '@plo/shared';

/** プライズ・ブラインド表示専用（bb / K / M などの省略なし） */
function formatChipsAbsolute(amount: number): string {
  return Math.round(amount).toLocaleString('ja-JP');
}

/** 次レベルまで（想定1時間未満）を MM:SS で表示 */
function formatTimeToNextLevel(targetMs: number): string {
  const diff = Math.max(0, targetMs - Date.now());
  const totalMin = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${String(totalMin).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function prizeOrdinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}TH`;
  switch (n % 10) {
    case 1:
      return `${n}ST`;
    case 2:
      return `${n}ND`;
    case 3:
      return `${n}RD`;
    default:
      return `${n}TH`;
  }
}

interface TournamentClockPanelProps {
  tournamentState: ClientTournamentState;
  onClose: () => void;
}

const FINAL_LEVEL_CLOCK = '--:--';

export function TournamentClockPanel({ tournamentState: ts, onClose }: TournamentClockPanelProps) {
  const isFinalBlindLevel = ts.nextBlindLevel == null;
  const [clock, setClock] = useState(() =>
    isFinalBlindLevel ? FINAL_LEVEL_CLOCK : formatTimeToNextLevel(ts.nextLevelAt),
  );

  useEffect(() => {
    if (ts.nextBlindLevel == null) {
      setClock(FINAL_LEVEL_CLOCK);
      return;
    }
    const tick = () => setClock(formatTimeToNextLevel(ts.nextLevelAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [ts.nextLevelAt, ts.nextBlindLevel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const bl = ts.currentBlindLevel;
  const next = ts.nextBlindLevel;
  const payouts = [...ts.payoutStructure].sort((a, b) => a.position - b.position).slice(0, 8);

  return (
    <div
      className="fixed inset-0 z-[285] flex items-center justify-center bg-black/55 p-[2.5cqw]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="@container relative flex min-h-0 min-w-0 w-full max-w-[96cqw] max-h-[90%] flex-col overflow-hidden border-2 border-white/45 bg-[#0000cc] text-white shadow-2xl [text-shadow:0_1px_3px_rgba(0,0,0,0.45),0_0_1px_rgba(0,0,0,0.25)]"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tournament-clock-title"
      >
        {/* —— ヘッダー（全幅） —— */}
        <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-[1.5cqw] border-b-2 border-white/45 px-[2.5cqw] py-[2.6cqw]">
          <div className="flex min-w-0 justify-start">
            <Trophy
              className="h-[6.8cqw] w-[6.8cqw] shrink-0 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
              strokeWidth={2}
              aria-hidden
            />
          </div>
          <h2
            id="tournament-clock-title"
            className="mx-auto min-w-0 max-w-[56cqw] text-center text-[3.5cqw] font-semibold leading-tight tracking-wide text-white"
          >
            <span className="block truncate">{ts.name}</span>
          </h2>
          <div className="flex min-w-0 justify-end">
            <div className="shrink-0 text-[5.2cqw] font-black leading-none tracking-tight text-white tabular-nums">
              LEVEL {bl.level}
            </div>
          </div>
        </header>

        {/* —— 本体：左＝賞金 / 中央＝クロック＆ブラインド / 右＝統計 —— */}
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[1fr_1.45fr_1fr]">
          {/* 左カラム：プライズ */}
          <section className="flex min-h-0 min-w-0 flex-col border-r-2 border-white/45 px-[2.5cqw] py-[2.5cqw]">
            {payouts.length === 0 ? (
              <p className="text-[3.2cqw] text-white">—</p>
            ) : (
              <ul className="min-h-0 flex-1 space-y-[1cqw] overflow-y-auto text-[3.3cqw] leading-snug">
                {payouts.map(p => (
                  <li
                    key={p.position}
                    className="flex justify-between gap-[1.5cqw] border-b border-white/30 pb-[0.6cqw] last:border-b-0 whitespace-nowrap"
                  >
                    <span className="shrink-0 font-medium text-white">{prizeOrdinal(p.position)}</span>
                    <span className="min-w-0 shrink text-right font-semibold tabular-nums text-white overflow-hidden text-ellipsis">
                      {formatChipsAbsolute(p.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-auto min-w-0 border-t-2 border-white/40 pt-[2.2cqw]">
              <div className="text-[2.3cqw] font-medium uppercase tracking-tight text-white whitespace-nowrap">
                TOTAL PRIZE POOL
              </div>
              <div className="mt-[0.5cqw] text-[3.8cqw] font-bold tabular-nums text-white whitespace-nowrap">
                {formatChipsAbsolute(ts.prizePool)}
              </div>
            </div>
          </section>

          {/* 中央カラム */}
          <section className="flex min-h-0 min-w-0 flex-col justify-between border-r-2 border-white/45 px-[2cqw] py-[3cqw]">
            <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center overflow-hidden">
              <span className="max-w-full whitespace-nowrap text-center font-mono text-[min(12.5cqw,20cqmin)] font-black leading-none tabular-nums tracking-tight text-white">
                {clock}
              </span>
            </div>
            <div className="mt-[2.5cqw] min-w-0 w-full space-y-[1.6cqw] border-t-2 border-white/35 pt-[2.6cqw] text-left text-[3.2cqw] leading-snug">
              <div className="whitespace-nowrap">
                <span className="font-semibold text-white">BLINDS: </span>
                <span className="tabular-nums text-white">
                  {formatChipsAbsolute(bl.smallBlind)}/{formatChipsAbsolute(bl.bigBlind)}
                </span>
              </div>
              <div className="whitespace-nowrap">
                <span className="font-semibold text-white">ANTE: </span>
                <span className="tabular-nums text-white">{formatChipsAbsolute(bl.ante)}</span>
              </div>
              <div className="text-white whitespace-nowrap overflow-x-auto">
                <span className="font-semibold text-white">NEXT LEVEL: </span>
                {next ? (
                  <span className="tabular-nums">
                    {formatChipsAbsolute(next.smallBlind)}/{formatChipsAbsolute(next.bigBlind)}
                    {next.ante > 0 ? ` (${formatChipsAbsolute(next.ante)})` : ''}
                  </span>
                ) : (
                  <span className="text-white">—</span>
                )}
              </div>
            </div>
          </section>

          {/* 右カラム */}
          <section className="flex min-h-0 min-w-0 flex-col gap-0 px-[2.5cqw] py-[2.5cqw]">
            <RightStat label="NEXT BREAK IN" value="—" valueClass="font-mono" />
            <RightStat label="AVG STACK" value={formatChipsAbsolute(ts.averageStack)} />
            <RightStat
              label="PLAYERS"
              value={`${ts.playersRemaining}/${ts.totalPlayers}`}
            />
            {ts.myChips != null && <RightStat label="MY STACK" value={formatChipsAbsolute(ts.myChips)} />}
          </section>
        </div>

        {/* —— フッター —— */}
        <footer className="border-t-2 border-white/45 px-[2.5cqw] py-[2.2cqw]">
          <p className="text-center text-[2.9cqw] font-medium leading-tight text-white">
            タイマーがゼロになるとブラインドが上がります
          </p>
        </footer>
      </div>
    </div>
  );
}

function RightStat({
  label,
  value,
  valueClass = '',
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="border-b border-white/40 py-[2.2cqw] first:pt-0 last:border-b-0">
      <div className="text-[2.6cqw] font-medium uppercase tracking-tight text-white whitespace-nowrap overflow-x-auto">
        {label}
      </div>
      <div
        className={`mt-[0.5cqw] text-[3.8cqw] font-semibold tabular-nums text-white whitespace-nowrap overflow-x-auto ${valueClass}`}
      >
        {value}
      </div>
    </div>
  );
}
