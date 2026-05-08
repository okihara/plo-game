import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ReactNode } from 'react';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONT_CACHE_DIR = join(__dirname, 'fonts');
const FONT_BOLD_PATH = join(FONT_CACHE_DIR, 'NotoSansCJKjp-Bold.otf');
const FONT_REGULAR_PATH = join(FONT_CACHE_DIR, 'NotoSansCJKjp-Regular.otf');

const FONT_URLS = {
  bold: 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf',
  regular: 'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',
};

// フォントをダウンロードしてキャッシュ
async function downloadFont(url: string, path: string): Promise<Buffer> {
  if (existsSync(path)) {
    return readFileSync(path);
  }
  console.log(`Downloading font: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Font download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!existsSync(FONT_CACHE_DIR)) mkdirSync(FONT_CACHE_DIR, { recursive: true });
  writeFileSync(path, buf);
  console.log(`Font cached: ${path} (${(buf.length / 1024 / 1024).toFixed(1)}MB)`);
  return buf;
}

// フォントを遅延初期化
let fontsPromise: Promise<{ regular: Buffer; bold: Buffer }> | null = null;

function getFonts() {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      downloadFont(FONT_URLS.regular, FONT_REGULAR_PATH),
      downloadFont(FONT_URLS.bold, FONT_BOLD_PATH),
    ]).then(([regular, bold]) => ({ regular, bold }));
  }
  return fontsPromise;
}

interface OgpStats {
  handsPlayed: number;
  totalProfit: number;
  winRate: number;
  totalAllInEVProfit: number;
  evWinRate: number;
  vpip: number;
  pfr: number;
  threeBet: number;
  afq: number;
  cbet: number;
  foldToCbet: number;
  foldTo3Bet: number;
}

interface ProfitPoint {
  c: number;  // cumulative total
  e: number;  // cumulative EV
  s: number;  // cumulative showdown
  n: number;  // cumulative non-showdown
}

const WIDTH = 1200;
const HEIGHT = 630;

function formatProfit(profit: number): string {
  const sign = profit >= 0 ? '+' : '';
  return `${sign}${profit.toLocaleString()}`;
}

// satori用のJSX-like要素ヘルパー（React不要、plain object）
function h(type: string, props: Record<string, unknown>, ...children: unknown[]): ReactNode {
  return { type, props: { ...props, children: children.length === 1 ? children[0] : children } } as unknown as ReactNode;
}

function StatBlock(label: string, value: string, color?: string, small?: boolean) {
  return h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 } },
    h('div', { style: { display: 'flex', fontSize: small ? 14 : 15, color: '#666', marginBottom: 3 } }, label),
    h('div', { style: { display: 'flex', fontSize: small ? 22 : 24, fontWeight: 700, color: color || '#1a1a1a' } }, value),
  );
}

/** 左パネル用: 横並び label + value */
function StatRow(label: string, value: string, color?: string) {
  return h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' } },
    h('div', { style: { display: 'flex', fontSize: 16, color: '#666' } }, label),
    h('div', { style: { display: 'flex', fontSize: 20, fontWeight: 700, color: color || '#1a1a1a' } }, value),
  );
}

// チャート用ヘルパー
function formatCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(v / 1_000).toFixed(0)}k`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return v.toString();
}

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

function buildChartWithLabels(points: ProfitPoint[], totalWidth: number, chartHeight: number): ReactNode {
  const Y_LABEL_W = 48;  // Y軸ラベル幅
  const X_LABEL_H = 18;  // X軸ラベル高さ
  const CW = totalWidth - Y_LABEL_W;
  const CH = chartHeight;
  const PAD = 8;

  const allValues = points.flatMap(pt => [pt.c, pt.e, pt.s, pt.n]);
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);

  const yTicks = niceTicks(rawMin, rawMax, 4);
  const tickStep = yTicks.length >= 2 ? yTicks[1] - yTicks[0] : Math.abs(rawMax - rawMin) || 1;
  if (!yTicks.some(t => t > 0)) yTicks.push(yTicks[yTicks.length - 1] + tickStep);
  if (!yTicks.some(t => t < 0)) yTicks.unshift(yTicks[0] - tickStep);
  const adjMinY = Math.min(...yTicks, rawMin);
  const adjMaxY = Math.max(...yTicks, rawMax);
  const rangeY = (adjMaxY - adjMinY) || 1;

  const chartW = CW - PAD * 2;
  const chartH = CH - PAD * 2;

  const toX = (i: number) => PAD + (i / (points.length - 1)) * chartW;
  const toY = (val: number) => PAD + (1 - (val - adjMinY) / rangeY) * chartH;

  const totalLine = points.map((pt, i) => `${toX(i)},${toY(pt.c)}`).join(' ');
  const evLine = points.map((pt, i) => `${toX(i)},${toY(pt.e)}`).join(' ');
  const sdLine = points.map((pt, i) => `${toX(i)},${toY(pt.s)}`).join(' ');
  const noSdLine = points.map((pt, i) => `${toX(i)},${toY(pt.n)}`).join(' ');

  const gridElements: ReactNode[] = [];
  for (const v of yTicks) {
    gridElements.push(
      h('line', {
        x1: PAD, y1: toY(v), x2: CW - PAD, y2: toY(v),
        stroke: v === 0 ? '#B8AD9E' : '#E8E0D4',
        strokeWidth: v === 0 ? 1.2 : 0.6,
        strokeDasharray: v === 0 ? undefined : '4 3',
      }),
    );
  }

  const svgChart = h('svg', {
    viewBox: `0 0 ${CW} ${CH}`,
    width: CW,
    height: CH,
    xmlns: 'http://www.w3.org/2000/svg',
  },
    ...gridElements,
    h('polyline', { points: noSdLine, fill: 'none', stroke: '#FF0000', strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
    h('polyline', { points: sdLine, fill: 'none', stroke: '#0080FF', strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
    h('polyline', { points: evLine, fill: 'none', stroke: '#FFB800', strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' }),
    h('polyline', { points: totalLine, fill: 'none', stroke: '#00C000', strokeWidth: 2.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
  );

  // Y軸ラベル（HTML divで実現）
  const yLabels = yTicks.map(v =>
    h('div', {
      style: {
        display: 'flex', position: 'absolute',
        right: CW + 4, top: toY(v) - 7,
        fontSize: 11, color: '#666', whiteSpace: 'nowrap',
      },
    }, formatCompact(v)),
  );

  // X軸ラベル（ハンド数）
  const totalHands = points.length;
  const xTickCount = 4;
  const xLabels: ReactNode[] = [];
  for (let i = 0; i <= xTickCount; i++) {
    const idx = Math.round((i / xTickCount) * (totalHands - 1));
    const handNum = idx + 1;
    xLabels.push(
      h('div', {
        style: {
          display: 'flex', position: 'absolute',
          left: Y_LABEL_W + toX(idx) - 15,
          top: CH + 2,
          width: 30, justifyContent: 'center',
          fontSize: 11, color: '#666',
        },
      }, handNum.toLocaleString()),
    );
  }

  return h('div', {
    style: { display: 'flex', position: 'relative', width: totalWidth, height: CH + X_LABEL_H },
  },
    // SVGチャート本体（右寄せ）
    h('div', { style: { display: 'flex', position: 'absolute', left: Y_LABEL_W, top: 0 } }, svgChart),
    // Y軸ラベル
    ...yLabels,
    // X軸ラベル
    ...xLabels,
  );
}

function buildElement(name: string, stats: OgpStats | null, profitPoints: ProfitPoint[] | null): ReactNode {
  const profitColor = (v: number) => v >= 0 ? '#2d6a4f' : '#C0392B';
  const hasChart = profitPoints && profitPoints.length >= 2;
  const SIDE_PAD = 48;
  const CONTENT_W = WIDTH - SIDE_PAD * 2; // 1104
  const GAP = 28;
  const LEFT_W = hasChart ? 380 : CONTENT_W;
  const RIGHT_W = CONTENT_W - LEFT_W - GAP;

  // ── 左パネル: スタッツ ──
  const leftPanel = stats
    ? h('div', { style: { display: 'flex', flexDirection: 'column', width: LEFT_W } },
        // 収支セクション
        h('div', { style: { display: 'flex', flexDirection: 'column', marginBottom: 12 } },
          ...[
            ['総ハンド数', stats.handsPlayed.toLocaleString(), undefined],
            ['実収支', formatProfit(stats.totalProfit), profitColor(stats.totalProfit)],
            ['Win Rate', `${stats.winRate >= 0 ? '+' : ''}${stats.winRate.toFixed(1)}`, profitColor(stats.winRate)],
            ['収支 (EV)', formatProfit(stats.totalAllInEVProfit), profitColor(stats.totalAllInEVProfit)],
            ['WR (EV)', `${stats.evWinRate >= 0 ? '+' : ''}${stats.evWinRate.toFixed(1)}`, profitColor(stats.evWinRate)],
          ].map(([l, v, c]) =>
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' } },
              h('div', { style: { display: 'flex', fontSize: 20, color: '#333' } }, l),
              h('div', { style: { display: 'flex', fontSize: 28, fontWeight: 700, color: (c as string) || '#1a1a1a' } }, v),
            ),
          ),
        ),
        // 区切り線
        h('div', { style: { display: 'flex', width: '100%', height: 1, backgroundColor: '#d8d2c8', marginBottom: 12 } }),
        // ポーカースタッツ（VPIP / PFR / 3Bet）
        h('div', { style: { display: 'flex', flexDirection: 'column' } },
          ...[
            ['VPIP', `${stats.vpip.toFixed(1)}%`],
            ['PFR', `${stats.pfr.toFixed(1)}%`],
            ['3Bet', `${stats.threeBet.toFixed(1)}%`],
          ].map(([l, v]) =>
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' } },
              h('div', { style: { display: 'flex', fontSize: 20, color: '#333' } }, l),
              h('div', { style: { display: 'flex', fontSize: 28, fontWeight: 700, color: '#1a1a1a' } }, v),
            ),
          ),
        ),
      )
    : h('div', { style: { display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { display: 'flex', fontSize: 24, color: '#666' } }, 'スタッツはまだありません'),
      );

  // ── 右パネル: チャート ──
  const CHART_PAD = 16;
  const chartInnerW = RIGHT_W - CHART_PAD * 2;
  const rightPanel = hasChart
    ? h('div', {
        style: {
          display: 'flex', flexDirection: 'column', width: RIGHT_W, flex: 1,
          backgroundColor: '#f0ece6', borderRadius: 16, padding: `14px ${CHART_PAD}px 16px`,
        },
      },
        // 凡例
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 12, marginBottom: 8 } },
          ...[
            ['#00C000', 'Total'],
            ['#FFB800', 'EV'],
            ['#0080FF', 'SD'],
            ['#FF0000', 'Non-SD'],
          ].map(([c, t]) =>
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 4 } },
              h('div', { style: { display: 'flex', width: 16, height: 3, backgroundColor: c, borderRadius: 2 } }),
              h('div', { style: { display: 'flex', fontSize: 12, fontWeight: 700, color: '#666' } }, t),
            ),
          ),
        ),
        // チャート本体
        buildChartWithLabels(profitPoints!, chartInnerW, 340),
      )
    : null;

  // ── メインレイアウト ──
  const bodyContent = hasChart
    ? h('div', { style: { display: 'flex', flex: 1, gap: GAP, paddingTop: 16, paddingBottom: 12 } },
        leftPanel,
        rightPanel,
      )
    : h('div', { style: { display: 'flex', flex: 1, paddingTop: 16, paddingBottom: 12 } },
        leftPanel,
      );

  return h('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#faf8f5',
      padding: `0 ${SIDE_PAD}px`,
      fontFamily: 'Noto Sans CJK JP',
    },
  },
    // 上部アクセントライン
    h('div', { style: { display: 'flex', position: 'absolute', top: 0, left: 0, right: 0, height: 6, backgroundColor: '#1a1a1a' } }),
    // ヘッダー
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 32, marginBottom: 12 } },
      h('div', { style: { display: 'flex', fontSize: 34, fontWeight: 700, color: '#1a1a1a' } }, name),
      h('div', { style: { display: 'flex', fontSize: 18, color: '#1a1a1a', fontWeight: 700 } }, 'Baby PLO'),
    ),
    // 区切り線
    h('div', { style: { display: 'flex', width: '100%', height: 1, backgroundColor: '#d8d2c8' } }),
    // メインコンテンツ（左右分割）
    bodyContent,
    // フッター
    h('div', { style: { display: 'flex', justifyContent: 'center', paddingBottom: 16, paddingTop: 8 } },
      h('div', { style: { display: 'flex', fontSize: 14, color: '#888' } }, 'baby-plo.app'),
    ),
  );
}

export async function renderOgpImage(name: string, stats: OgpStats | null, profitPoints?: ProfitPoint[] | null): Promise<Buffer> {
  const fonts = await getFonts();
  const element = buildElement(name, stats, profitPoints ?? null);

  const svg = await satori(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [
      {
        name: 'Noto Sans CJK JP',
        data: fonts.regular,
        weight: 400,
        style: 'normal' as const,
      },
      {
        name: 'Noto Sans CJK JP',
        data: fonts.bold,
        weight: 700,
        style: 'normal' as const,
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
  });

  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
