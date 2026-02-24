interface Point {
  p: number;  // per-hand profit
  c: number;  // cumulative total
  s: number;  // cumulative showdown
  n: number;  // cumulative non-showdown
  e: number;  // cumulative EV profit
}

interface ProfitChartProps {
  points: Point[];
}

const W = 300;
const H = 160;
const PAD_L = 40;  // left padding for Y labels
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 18;  // bottom padding for X labels

const COLORS = {
  total: '#00C000',
  ev: '#FFB800',
  showdown: '#0080FF',
  nonShowdown: '#FF0000',
} as const;

type SeriesKey = 'total' | 'ev' | 'showdown' | 'nonShowdown';

const LABELS: Record<SeriesKey, string> = {
  total: 'Total',
  ev: 'EV',
  showdown: 'Showdown',
  nonShowdown: 'Non-SD',
};

function buildPolyline(
  points: Point[],
  getValue: (pt: Point) => number,
  toX: (i: number) => number,
  toY: (v: number) => number,
): string {
  return points.map((pt, i) => `${toX(i)},${toY(getValue(pt))}`).join(' ');
}

/** Generate nice tick values covering the range [min, max] */
function niceTicks(min: number, max: number, maxCount: number): number[] {
  const range = max - min;
  if (range === 0) return [0];

  const rough = range / maxCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  let step: number;
  if (residual <= 1.5) step = 1 * mag;
  else if (residual <= 3) step = 2 * mag;
  else if (residual <= 7) step = 5 * mag;
  else step = 10 * mag;

  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 0.01; v += step) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toString();
}

export function ProfitChart({ points }: ProfitChartProps) {
  if (points.length < 2) return null;

  const allValues = points.flatMap(pt => [pt.c, pt.s, pt.n, pt.e]);
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);

  // Ensure at least 1 tick above and below zero
  const yTicks = niceTicks(rawMin, rawMax, 4);
  const tickStep = yTicks.length >= 2 ? yTicks[1] - yTicks[0] : Math.abs(rawMax - rawMin) || 1;
  if (!yTicks.some(t => t > 0)) yTicks.push(yTicks[yTicks.length - 1] + tickStep);
  if (!yTicks.some(t => t < 0)) yTicks.unshift(yTicks[0] - tickStep);
  // Drawing range must cover both ticks AND actual data
  const adjMinY = Math.min(...yTicks, rawMin);
  const adjMaxY = Math.max(...yTicks, rawMax);
  const rangeY = (adjMaxY - adjMinY) || 1;

  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;

  const toX = (i: number) => PAD_L + (i / (points.length - 1)) * chartW;
  const toY = (val: number) => PAD_T + (1 - (val - adjMinY) / rangeY) * chartH;

  // X-axis ticks (hand numbers)
  const totalHands = points.length;
  const xTickCount = Math.min(4, totalHands);
  const xTicks: number[] = [];
  for (let i = 0; i < xTickCount; i++) {
    const idx = Math.round((i / (xTickCount - 1)) * (totalHands - 1));
    xTicks.push(idx);
  }

  const series: { key: SeriesKey; get: (pt: Point) => number; color: string; width: number }[] = [
    { key: 'nonShowdown', get: pt => pt.n, color: COLORS.nonShowdown, width: 1 },
    { key: 'showdown', get: pt => pt.s, color: COLORS.showdown, width: 1 },
    { key: 'ev', get: pt => pt.e, color: COLORS.ev, width: 1.2 },
    { key: 'total', get: pt => pt.c, color: COLORS.total, width: 1.5 },
  ];

  const last = points[points.length - 1];

  const formatVal = (v: number) => `${v >= 0 ? '+' : ''}${v.toLocaleString()}`;
  const valColor = (v: number) => v >= 0 ? 'text-forest' : 'text-[#C0392B]';

  return (
    <div className="mt-[3cqw]">
      <h3 className="text-cream-600 text-[3cqw] uppercase tracking-wider mb-[2cqw]">
        収支推移
      </h3>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
          style={{ height: 'auto', aspectRatio: `${W}/${H}` }}
        >
          {/* Y-axis grid lines & labels */}
          {yTicks.map(v => (
            <g key={`y-${v}`}>
              <line
                x1={PAD_L} y1={toY(v)} x2={W - PAD_R} y2={toY(v)}
                stroke={v === 0 ? '#B8AD9E' : '#E8E0D4'}
                strokeWidth={v === 0 ? 0.6 : 0.4}
                strokeDasharray={v === 0 ? undefined : '3 2'}
              />
              <text
                x={PAD_L - 4} y={toY(v)}
                textAnchor="end" dominantBaseline="middle"
                fill="#8B7E6A" fontSize="7"
              >
                {formatCompact(v)}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xTicks.map(idx => (
            <text
              key={`x-${idx}`}
              x={toX(idx)} y={H - PAD_B + 12}
              textAnchor="middle" dominantBaseline="middle"
              fill="#8B7E6A" fontSize="7"
            >
              {idx + 1}
            </text>
          ))}

          {/* Clip chart area */}
          <defs>
            <clipPath id="chart-clip">
              <rect x={PAD_L} y={PAD_T} width={chartW} height={chartH} />
            </clipPath>
          </defs>

          {/* Series lines */}
          <g clipPath="url(#chart-clip)">
            {series.map(s => (
              <polyline
                key={s.key}
                points={buildPolyline(points, s.get, toX, toY)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.width}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
          </g>
        </svg>

        {/* Legend */}
        <div className="flex items-center justify-between mt-[1.5cqw]">
          <span className="text-cream-500 text-[2.2cqw]">
            {points.length} hands
          </span>
          <div className="flex items-center gap-[3cqw]">
            {series.slice().reverse().map(s => (
              <div key={s.key} className="flex items-center gap-[1cqw]">
                <span
                  className="inline-block w-[2.5cqw] h-[0.6cqw] rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className={`text-[2.2cqw] font-semibold ${valColor(s.get(last))}`}>
                  {LABELS[s.key]} {formatVal(s.get(last))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
