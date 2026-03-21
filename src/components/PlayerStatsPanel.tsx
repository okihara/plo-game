import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

/** 親パネル幅の 1% を px にした値（= 1cqw 相当）。ポータルは body 直下のため CSS の cqw が使えない */
const StatsPanelCqContext = createContext<number>(3.6);

function useStatsPanelCq() {
  return useContext(StatsPanelCqContext);
}

export interface PlayerStatsDisplay {
  handsPlayed: number;
  winRate: number;
  totalProfit: number;
  totalAllInEVProfit: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  fourBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
}

interface PlayerStatsPanelProps {
  loading: boolean;
  stats: PlayerStatsDisplay | null;
  /** データなし時にプレースホルダー行を表示（プロフィールポップアップ用） */
  showPlaceholderWhenEmpty?: boolean;
}

const statInfo: Record<string, { desc: string; formula: string }> = {
  総ハンド数: { desc: 'プレイしたハンド数', formula: '参加ハンドの合計' },
  実収支: { desc: '総損益（チップ）', formula: '全ハンドの獲得チップ合計' },
  'Win Rate': { desc: '1ハンドあたりの実損益', formula: '実収支 ÷ 総ハンド数' },
  '収支 (EV)': { desc: 'オールイン時のエクイティに基づく期待損益', formula: 'Σ(エクイティ × ポット額 - ベット額)' },
  'Win Rate (EV)': { desc: '1ハンドあたりのEV期待損益', formula: 'EV損益合計 ÷ 総ハンド数' },
  VPIP: { desc: '自発的にポットに参加した割合', formula: '(コール+レイズ) ÷ 総ハンド数 × 100' },
  PFR: { desc: 'プリフロップでレイズした割合', formula: 'PFレイズ数 ÷ 総ハンド数 × 100' },
  '3Bet': { desc: 'プリフロップで3ベットした割合', formula: '3ベット数 ÷ 3ベット機会数 × 100' },
  '4Bet': { desc: 'プリフロップで4ベットした割合', formula: '4ベット数 ÷ 4ベット機会数 × 100' },
  AFq: { desc: 'ポストフロップのアグレッション頻度', formula: '(ベット+レイズ) ÷ (ベット+レイズ+コール+フォールド) × 100' },
  CBet: { desc: 'PFレイザーがフロップでベットした割合', formula: 'Cベット数 ÷ Cベット機会数 × 100' },
  'Fold to CB': { desc: 'Cベットに対してフォールドした割合', formula: 'CB被フォールド数 ÷ CB被回数 × 100' },
  'Fold to 3B': { desc: '3ベットに対してフォールドした割合', formula: '3B被フォールド数 ÷ 3B被回数 × 100' },
};

function formatProfit(profit: number): string {
  const sign = profit >= 0 ? '+' : '';
  return `${sign}${profit.toLocaleString()}`;
}

function formatRate(rate: number): string {
  const sign = rate >= 0 ? '+' : '';
  return `${sign}${rate.toFixed(1)}`;
}

export function PlayerStatsPanel({
  loading,
  stats,
  showPlaceholderWhenEmpty = false,
}: PlayerStatsPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidthPx, setContainerWidthPx] = useState(0);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setContainerWidthPx(w);
    });
    ro.observe(el);
    const w0 = el.getBoundingClientRect().width;
    if (w0 > 0) setContainerWidthPx(w0);
    return () => ro.disconnect();
  }, []);

  const cq =
    containerWidthPx > 0
      ? containerWidthPx / 100
      : typeof window !== 'undefined'
        ? Math.min(400, window.innerWidth * 0.92) / 100
        : 3.6;

  const evProfit = stats ? stats.totalAllInEVProfit ?? stats.totalProfit : 0;
  const evWinRate = stats && stats.handsPlayed > 0 ? evProfit / stats.handsPlayed : 0;

  const inner = loading ? (
    <div className="rounded-[3cqw] border border-cream-200/90 bg-gradient-to-b from-cream-50 to-cream-100/80 px-[3cqw] py-[2.5cqw]">
      <div className="flex flex-col items-center py-[2cqw]">
        <div className="w-[5cqw] h-[5cqw] border-2 border-cream-300 border-t-forest rounded-full animate-spin" />
        <p className="text-cream-800 text-[2.5cqw] mt-[1.2cqw]">読み込み中...</p>
      </div>
    </div>
  ) : !stats ? (
    !showPlaceholderWhenEmpty ? null : (
      <div className="rounded-[3cqw] border border-cream-200/90 bg-gradient-to-b from-cream-50 to-cream-100/80 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <StatBlock>
          <StatRow label="総ハンド数" value="—" isPlaceholder emphasize />
          <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
            <StatRow label="実収支" value="—" isPlaceholder dense />
            <StatRow label="Win Rate" value="—" isPlaceholder dense />
            <StatRow label="収支 (EV)" value="—" isPlaceholder dense />
            <StatRow label="Win Rate (EV)" value="—" isPlaceholder dense />
          </div>
        </StatBlock>
        <StatBlock>
          <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
            <StatRow label="VPIP" value="—" isPlaceholder dense />
            <StatRow label="PFR" value="—" isPlaceholder dense />
            <StatRow label="3Bet" value="—" isPlaceholder dense />
            <StatRow label="4Bet" value="—" isPlaceholder dense />
          </div>
        </StatBlock>
        <StatBlock isLast>
          <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
            <StatRow label="AFq" value="—" isPlaceholder dense />
            <StatRow label="CBet" value="—" isPlaceholder dense />
            <StatRow label="Fold to CB" value="—" isPlaceholder dense />
            <StatRow label="Fold to 3B" value="—" isPlaceholder dense />
          </div>
        </StatBlock>
      </div>
    )
  ) : (
    <div className="rounded-[3cqw] border border-cream-200/90 bg-gradient-to-b from-cream-50 to-cream-100/80 overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
      <StatBlock>
        <StatRow label="総ハンド数" value={stats.handsPlayed.toLocaleString()} emphasize />
        <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
          <StatRow
            label="実収支"
            value={formatProfit(stats.totalProfit)}
            valueClass={stats.totalProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'}
            dense
          />
          <StatRow
            label="Win Rate"
            value={formatRate(stats.winRate)}
            valueClass={stats.winRate >= 0 ? 'text-forest' : 'text-[#C0392B]'}
            dense
          />
          <StatRow
            label="収支 (EV)"
            value={formatProfit(evProfit)}
            valueClass={evProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'}
            dense
          />
          <StatRow
            label="Win Rate (EV)"
            value={formatRate(evWinRate)}
            valueClass={evProfit >= 0 ? 'text-forest' : 'text-[#C0392B]'}
            dense
          />
        </div>
      </StatBlock>
      <StatBlock>
        <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
          <StatRow label="VPIP" value={`${stats.vpip.toFixed(1)}%`} dense />
          <StatRow label="PFR" value={`${stats.pfr.toFixed(1)}%`} dense />
          <StatRow label="3Bet" value={`${stats.threeBet.toFixed(1)}%`} dense />
          <StatRow label="4Bet" value={`${stats.fourBet.toFixed(1)}%`} dense />
        </div>
      </StatBlock>
      <StatBlock isLast>
        <div className="grid grid-cols-2 gap-x-[2cqw] gap-y-[0.4cqw]">
          <StatRow label="AFq" value={`${stats.afq.toFixed(1)}%`} dense />
          <StatRow label="CBet" value={`${stats.cbet.toFixed(1)}%`} dense />
          <StatRow label="Fold to CB" value={`${stats.foldToCbet.toFixed(1)}%`} dense />
          <StatRow label="Fold to 3B" value={`${stats.foldTo3Bet.toFixed(1)}%`} dense />
        </div>
      </StatBlock>
    </div>
  );

  return (
    <StatsPanelCqContext.Provider value={cq}>
      <div ref={rootRef} className="w-full min-w-0">
        {inner}
      </div>
    </StatsPanelCqContext.Provider>
  );
}

/** セクション見出しなし。ブロック間は区切り線のみ */
function StatBlock({ isLast, children }: { isLast?: boolean; children: ReactNode }) {
  return (
    <div className={`px-[3cqw] py-[1.4cqw] ${isLast ? '' : 'border-b border-cream-200/70'}`}>
      <div className="flex flex-col gap-[0.5cqw]">{children}</div>
    </div>
  );
}

type TooltipPlacement = { top: number; left: number; width: number; maxHeight: number };

function StatRow({
  label,
  value,
  valueClass,
  emphasize,
  isPlaceholder,
  dense,
}: {
  label: string;
  value: string;
  valueClass?: string;
  emphasize?: boolean;
  isPlaceholder?: boolean;
  dense?: boolean;
}) {
  const cq = useStatsPanelCq();
  const info = statInfo[label];
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [placement, setPlacement] = useState<TooltipPlacement | null>(null);

  useLayoutEffect(() => {
    if (!showTooltip) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // 画面端クランプは px（ビューポート）。余白・ギャップ・幅はパネル cqw 相当 cq と整合
      const margin = Math.max(6, 0.8 * cq);
      const maxUsable = window.innerWidth - 2 * margin;
      const width = Math.min(
        48 * cq,
        Math.max(12 * cq, Math.floor(maxUsable * 0.5)),
      );
      const gap = 0.6 * cq;
      let left = r.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      const top = r.bottom + gap;
      const maxHeight = Math.max(12 * cq, window.innerHeight - top - margin);
      setPlacement({ top, left, width, maxHeight });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [showTooltip, cq]);

  useEffect(() => {
    if (!showTooltip) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (tooltipRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      setShowTooltip(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [showTooltip]);

  const rowClass = dense
    ? 'relative flex items-center justify-between gap-[2cqw] py-[0.45cqw] px-[1.2cqw] rounded-[1.2cqw] bg-white/25 border border-cream-200/30'
    : 'relative flex items-center justify-between gap-[2.5cqw] py-[0.55cqw] px-[1.5cqw] rounded-[1.2cqw] bg-white/35 border border-cream-200/40';

  const labelSize = dense ? 'text-[2.35cqw]' : 'text-[2.5cqw]';
  const iconBox = dense ? 'h-[2.8cqw] w-[2.8cqw]' : 'h-[3cqw] w-[3cqw]';
  const iconSize = dense ? 'w-[2.1cqw] h-[2.1cqw]' : 'w-[2.3cqw] h-[2.3cqw]';

  return (
    <div className={rowClass}>
      <div className="min-w-0 flex items-center gap-[0.5cqw]">
        <span className={`${labelSize} text-cream-900 leading-none ${emphasize ? 'font-semibold' : 'font-medium'}`}>
          {label}
        </span>
        {info && !isPlaceholder && (
          <button
            ref={anchorRef}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTooltip((v) => !v);
            }}
            className={`inline-flex items-center justify-center ${iconBox} rounded-md text-cream-700 shrink-0 hover:text-cream-900 hover:bg-cream-200/60 active:bg-cream-300/70`}
            aria-label={`${label}の説明`}
            aria-expanded={showTooltip}
          >
            <Info className={iconSize} strokeWidth={2.5} aria-hidden />
          </button>
        )}
      </div>
      <span
        className={`tabular-nums text-right shrink-0 leading-none ${
          emphasize
            ? `${dense ? 'text-[4.2cqw]' : 'text-[4.6cqw]'} font-bold text-cream-900`
            : `${dense ? 'text-[3.5cqw]' : 'text-[3.8cqw]'} font-bold`
        } ${isPlaceholder ? 'text-cream-700' : valueClass || 'text-cream-900'}`}
      >
        {value}
      </span>
      {showTooltip &&
        info &&
        placement &&
        createPortal(
          <div
            ref={tooltipRef}
            className="fixed z-[500] box-border overflow-y-auto overscroll-contain border border-cream-700 bg-cream-900 shadow-xl"
            style={{
              top: placement.top,
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              padding: `${2.5 * cq}px`,
              borderRadius: `${2 * cq}px`,
            }}
          >
            <div
              className="font-semibold leading-snug text-white"
              style={{ fontSize: `${3.2 * cq}px`, marginBottom: `${0.6 * cq}px` }}
            >
              {label}
            </div>
            <div
              className="leading-relaxed text-white"
              style={{ fontSize: `${2.8 * cq}px`, marginBottom: `${0.6 * cq}px` }}
            >
              {info.desc}
            </div>
            <div
              className="leading-snug text-emerald-200 bg-black/30"
              style={{
                fontSize: `${2.5 * cq}px`,
                borderRadius: `${0.6 * cq}px`,
                padding: `${0.6 * cq}px ${0.8 * cq}px`,
              }}
            >
              {info.formula}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
